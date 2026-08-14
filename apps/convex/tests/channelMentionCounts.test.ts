import { describe, expect, it } from "vitest";
import { ChannelType } from "@ripple/shared/enums/roles";
import { api, internal } from "../convex/_generated/api";
import { withTriggers } from "../convex/dbTriggers";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

/**
 * Mention-edge multiplicity. See CONTEXT.md "mention edge".
 *
 * The property under test is not "counts are right" for its own sake — it is
 * that the `edges` row is written on the 0->1 transition and deleted on 1->0
 * and at no other time. `edges.by_workspace` is the range the workspace graph
 * subscribes to, so any write there re-runs that query for every client on the
 * page; a mention of an already-mentioned target must not touch it.
 */

async function setup(t: ReturnType<typeof createTestContext>) {
  const { workspaceId, asUser, userId } = await setupWorkspaceWithAdmin(t);
  const channelId = await asUser.mutation(api.channels.create, {
    workspaceId,
    name: "general",
    type: ChannelType.OPEN,
  });
  const targetId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Alice", email: "alice@test.com" }),
  );
  return { workspaceId, asUser, userId, channelId, targetId };
}

function bodyMentioning(userId: string): string {
  return JSON.stringify([
    { type: "paragraph", content: [{ type: "userMention", props: { userId } }] },
  ]);
}

const emptyBody = JSON.stringify([{ type: "paragraph", content: [] }]);

function mentionEdges(t: ReturnType<typeof createTestContext>) {
  return t.run(async (ctx) =>
    (await ctx.db.query("edges").collect()).filter((e) => e.edgeType === "mentions"),
  );
}

function counters(t: ReturnType<typeof createTestContext>) {
  return t.run(async (ctx) => ctx.db.query("channelMentionCounts").collect());
}

async function send(
  t: ReturnType<typeof createTestContext>,
  asUser: Awaited<ReturnType<typeof setup>>["asUser"],
  channelId: Id<"channels">,
  targetId: string,
  isomorphicId: string,
) {
  await asUser.mutation(api.messages.send, {
    isomorphicId,
    body: bodyMentioning(targetId),
    plainText: "@Alice",
    channelId,
  });
  return t.run(async (ctx) => {
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();
    return msgs[msgs.length - 1]._id;
  });
}

describe("channel mention counts", () => {
  it("keeps one edge across many mentions and removes it only at zero", async () => {
    const t = createTestContext();
    const { asUser, channelId, targetId } = await setup(t);

    const m1 = await send(t, asUser, channelId, targetId, "m1");
    const m2 = await send(t, asUser, channelId, targetId, "m2");
    const m3 = await send(t, asUser, channelId, targetId, "m3");

    expect(await mentionEdges(t)).toHaveLength(1);
    expect((await counters(t))[0].count).toBe(3);

    // Two of the three go away — the link is still real, so the edge stays.
    await asUser.mutation(api.messages.update, { id: m1, body: emptyBody, plainText: "" });
    expect(await mentionEdges(t)).toHaveLength(1);
    expect((await counters(t))[0].count).toBe(2);

    await asUser.mutation(api.messages.remove, { id: m2 });
    expect(await mentionEdges(t)).toHaveLength(1);
    expect((await counters(t))[0].count).toBe(1);

    // The last one: link genuinely disappears, edge and counter go together.
    await asUser.mutation(api.messages.update, { id: m3, body: emptyBody, plainText: "" });
    expect(await mentionEdges(t)).toHaveLength(0);
    expect(await counters(t)).toHaveLength(0);
  });

  it("does not write to edges when the target is already mentioned", async () => {
    // The whole point of the split: prove the second mention leaves the edge
    // row byte-identical, since any write to it re-runs the graph subscription.
    const t = createTestContext();
    const { asUser, channelId, targetId } = await setup(t);

    await send(t, asUser, channelId, targetId, "first");
    const before = (await mentionEdges(t))[0];

    await send(t, asUser, channelId, targetId, "second");
    const after = (await mentionEdges(t))[0];

    expect(after._id).toBe(before._id);
    expect(after._creationTime).toBe(before._creationTime);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("re-creates the edge when a target is mentioned again after dropping to zero", async () => {
    const t = createTestContext();
    const { asUser, channelId, targetId } = await setup(t);

    const m1 = await send(t, asUser, channelId, targetId, "a");
    await asUser.mutation(api.messages.update, { id: m1, body: emptyBody, plainText: "" });
    expect(await mentionEdges(t)).toHaveLength(0);

    await send(t, asUser, channelId, targetId, "b");
    const edges = await mentionEdges(t);
    expect(edges).toHaveLength(1);
    const c = await counters(t);
    expect(c).toHaveLength(1);
    expect(c[0].count).toBe(1);
    expect(c[0].edgeId).toBe(edges[0]._id);
  });

  it("counts each channel separately", async () => {
    const t = createTestContext();
    const { workspaceId, asUser, channelId, targetId } = await setup(t);
    const other = await asUser.mutation(api.channels.create, {
      workspaceId,
      name: "random",
      type: ChannelType.OPEN,
    });

    await send(t, asUser, channelId, targetId, "x1");
    await send(t, asUser, channelId, targetId, "x2");
    await send(t, asUser, other, targetId, "y1");

    expect(await mentionEdges(t)).toHaveLength(2);
    const byChannel = Object.fromEntries(
      (await counters(t)).map((c) => [c.channelId, c.count]),
    );
    expect(byChannel[channelId]).toBe(2);
    expect(byChannel[other]).toBe(1);
  });

  it("hard-deleting a message decrements, and a soft-deleted one owes nothing", async () => {
    // The trigger had no `delete` branch before this: a hard delete stranded
    // the count so no later edit could bring it back to zero.
    const t = createTestContext();
    const { asUser, channelId, targetId } = await setup(t);

    const m1 = await send(t, asUser, channelId, targetId, "h1");
    const m2 = await send(t, asUser, channelId, targetId, "h2");
    expect((await counters(t))[0].count).toBe(2);

    // A raw `t.run` delete fires no triggers, so the delete must go through a
    // trigger-aware writer to exercise the branch — the same wrapping the auth
    // callbacks use for writes that cannot go through our mutation builders.
    await t.run(async (ctx) => withTriggers(ctx).db.delete(m1));
    expect((await counters(t))[0].count).toBe(1);

    // Soft delete already decremented; hard-deleting the tombstone must not
    // double-count it down.
    await asUser.mutation(api.messages.remove, { id: m2 });
    expect(await counters(t)).toHaveLength(0);
    await t.run(async (ctx) => withTriggers(ctx).db.delete(m2));
    expect(await counters(t)).toHaveLength(0);
    expect(await mentionEdges(t)).toHaveLength(0);
  });

  it("cascades away with the channel and with the target", async () => {
    const t = createTestContext();
    const { workspaceId, asUser, channelId, targetId } = await setup(t);
    const other = await asUser.mutation(api.channels.create, {
      workspaceId,
      name: "second",
      type: ChannelType.OPEN,
    });
    await send(t, asUser, channelId, targetId, "c1");
    await send(t, asUser, other, targetId, "c2");
    expect(await counters(t)).toHaveLength(2);

    await asUser.mutation(api.channels.remove, { id: channelId });
    await t.finishAllScheduledFunctions(() => {});

    const remaining = await counters(t);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].channelId).toBe(other);
  });
});

describe("collapseChannelMentionEdges migration", () => {
  /** Seed the pre-migration shape: N identical edge rows, no counter. */
  async function seedLegacyDuplicates(
    t: ReturnType<typeof createTestContext>,
    opts: {
      workspaceId: Id<"workspaces">;
      channelId: Id<"channels">;
      targetId: string;
      n: number;
    },
  ) {
    await t.run(async (ctx) => {
      for (let i = 0; i < opts.n; i++) {
        await ctx.db.insert("edges", {
          sourceType: "channel",
          sourceId: opts.channelId,
          targetType: "user",
          targetId: opts.targetId,
          edgeType: "mentions",
          workspaceId: opts.workspaceId,
          createdAt: 1000 + i,
        });
      }
    });
  }

  async function runCollapse(t: ReturnType<typeof createTestContext>) {
    await t.mutation(internal.migrations.collapseChannelMentionEdges, {
      cursor: null,
      batchSize: 100,
    });
    await t.finishAllScheduledFunctions(() => {});
  }

  it("collapses duplicates to one edge carrying the true count", async () => {
    const t = createTestContext();
    const { workspaceId, channelId, targetId } = await setup(t);
    await t.run(async (ctx) => {
      for (const e of await ctx.db.query("edges").collect()) await ctx.db.delete(e._id);
      for (const c of await ctx.db.query("channelMentionCounts").collect()) {
        await ctx.db.delete(c._id);
      }
    });
    await seedLegacyDuplicates(t, { workspaceId, channelId, targetId, n: 5 });
    expect(await mentionEdges(t)).toHaveLength(5);

    await runCollapse(t);

    const edges = await mentionEdges(t);
    const c = await counters(t);
    expect(edges).toHaveLength(1);
    expect(c).toHaveLength(1);
    expect(c[0].count).toBe(5);
    expect(c[0].edgeId).toBe(edges[0]._id);
    // `lastAt` is the newest of the collapsed rows, not the first.
    expect(c[0].lastAt).toBe(1004);
  });

  it("is idempotent — a second run keeps the survivor and the count", async () => {
    // `runAll` executes on every deploy. Without the `edgeId` marker a re-run
    // would delete the kept edges and double every count.
    const t = createTestContext();
    const { workspaceId, channelId, targetId } = await setup(t);
    await t.run(async (ctx) => {
      for (const e of await ctx.db.query("edges").collect()) await ctx.db.delete(e._id);
      for (const c of await ctx.db.query("channelMentionCounts").collect()) {
        await ctx.db.delete(c._id);
      }
    });
    await seedLegacyDuplicates(t, { workspaceId, channelId, targetId, n: 4 });

    await runCollapse(t);
    const first = await counters(t);
    const firstEdges = await mentionEdges(t);

    await runCollapse(t);
    const second = await counters(t);
    const secondEdges = await mentionEdges(t);

    expect(secondEdges).toHaveLength(1);
    expect(secondEdges[0]._id).toBe(firstEdges[0]._id);
    expect(second).toHaveLength(1);
    expect(second[0].count).toBe(first[0].count);
    expect(second[0].count).toBe(4);
  });
});
