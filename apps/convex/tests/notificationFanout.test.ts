import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import { WorkspaceRole, ChannelRole } from "@ripple/shared/enums/roles";
import { SUBSCRIPTION_PAGE_SIZE } from "../convex/notificationSubscriptionSync";

/**
 * Creating an open channel subscribes every member of the workspace to it. That
 * is the one fanout in this codebase whose cost is linear in workspace size, and
 * it runs in a single transaction: the read and write counts are both O(members)
 * with no continuation, so it is the path that decides how large a workspace can
 * get before an unrelated action — someone creating a channel — starts throwing.
 *
 * So it drains in pages. This suite pins both halves: no single transaction
 * takes more than a page, and every member still ends up subscribed exactly
 * once however many transactions it takes to get there.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type TestContext = ReturnType<typeof createTestContext>;

/** Seed `count` members directly — raw inserts, so no trigger fires for them. */
async function seedMembers(
  t: TestContext,
  workspaceId: Id<"workspaces">,
  count: number,
): Promise<Id<"users">[]> {
  return t.run(async (ctx) => {
    const ids: Id<"users">[] = [];
    for (let i = 0; i < count; i++) {
      const userId = await ctx.db.insert("users", {
        name: `Member ${i}`,
        email: `member${i}@example.com`,
      });
      await ctx.db.insert("workspaceMembers", {
        userId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
      ids.push(userId);
    }
    return ids;
  });
}

async function subscribersOf(t: TestContext, channelId: Id<"channels">) {
  return t.run((ctx) =>
    ctx.db
      .query("notificationSubscriptions")
      .withIndex("by_scope_category", (q) =>
        q.eq("scope", channelId as string).eq("category", "chatChannelMessage"),
      )
      .collect(),
  );
}

describe("open-channel subscription fanout", () => {
  it("subscribes at most one page per transaction", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    await seedMembers(t, workspaceId, SUBSCRIPTION_PAGE_SIZE + 50);

    const channelId = await t.run((ctx) =>
      ctx.db.insert("channels", {
        name: "general",
        workspaceId,
        type: "open" as const,
      }),
    );

    // One page, run on its own. The transaction that would have handled the
    // whole workspace now handles a bounded slice of it and hands back where to
    // resume — that boundary is what keeps the write count off the caps.
    const first = await t.mutation(
      internal.notificationSubscriptionJobs.subscribeMembersPage,
      { channelId, workspaceId, cursor: null },
    );

    expect(first.isDone).toBe(false);
    expect(first.cursor).not.toBeNull();
    expect(await subscribersOf(t, channelId)).toHaveLength(SUBSCRIPTION_PAGE_SIZE);
  });

  it("subscribes every member of a workspace larger than one page", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId } = await setupWorkspaceWithAdmin(t);

    // Comfortably more than any sane page size, so a paged implementation has
    // to run more than one transaction to finish.
    const members = await seedMembers(t, workspaceId, 250);

    // Raw insert: the channels trigger is bypassed, so the fanout below is the
    // only thing creating subscriptions and the assertion is unambiguous.
    const channelId = await t.run((ctx) =>
      ctx.db.insert("channels", {
        name: "general",
        workspaceId,
        type: "open" as const,
      }),
    );

    await t.action(internal.notificationSubscriptionJobs.publicChannelCreated, {
      channelId,
      workspaceId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const subscribed = await subscribersOf(t, channelId);
    const subscribedIds = new Set(subscribed.map((row) => row.userId));

    expect(subscribedIds.size, "no member may be subscribed twice").toBe(
      subscribed.length,
    );
    for (const userId of [ownerId, ...members]) {
      expect(subscribedIds.has(userId), `member ${userId} was skipped`).toBe(true);
    }
    expect(subscribed).toHaveLength(members.length + 1);
  });

  it("unsubscribes at most one page per transaction when a channel goes private", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const members = await seedMembers(t, workspaceId, SUBSCRIPTION_PAGE_SIZE + 50);

    const channelId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("channels", {
        name: "leadership",
        workspaceId,
        type: "closed" as const,
      });
      // Subscriptions left over from when it was open — none of these users has
      // a channelMembers row, so all of them have to go.
      for (const userId of members) {
        await ctx.db.insert("notificationSubscriptions", {
          workspaceId,
          userId,
          category: "chatChannelMessage",
          scope: id,
        });
      }
      return id;
    });

    const first = await t.mutation(
      internal.notificationSubscriptionJobs.unsubscribeNonMembersPage,
      { channelId, cursor: null },
    );

    expect(first.isDone).toBe(false);
    expect(await subscribersOf(t, channelId)).toHaveLength(50);
  });

  it("keeps the channel's own members subscribed while draining the rest", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const everyone = await seedMembers(t, workspaceId, SUBSCRIPTION_PAGE_SIZE + 50);
    const stayers = everyone.slice(0, 3);

    const channelId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("channels", {
        name: "leadership",
        workspaceId,
        type: "closed" as const,
      });
      for (const userId of everyone) {
        await ctx.db.insert("notificationSubscriptions", {
          workspaceId,
          userId,
          category: "chatChannelMessage",
          scope: id,
        });
      }
      for (const userId of stayers) {
        await ctx.db.insert("channelMembers", {
          channelId: id,
          userId,
          workspaceId,
          role: ChannelRole.MEMBER,
        });
      }
      return id;
    });

    await t.action(internal.notificationSubscriptionJobs.channelMadePrivate, {
      channelId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const left = await subscribersOf(t, channelId);
    expect(left.map((row) => row.userId).sort()).toEqual([...stayers].sort());
  });

  it("runs through the trigger when a channel is created the way the app creates one", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const members = await seedMembers(t, workspaceId, 250);

    // The whole production path: mutation → channels insert trigger →
    // scheduled job → fanout. Until the VITEST branch in dbTriggers came out,
    // this ran inline inside the mutation's own transaction and proved nothing
    // about the path that actually ships.
    const channelId = await asUser.mutation(api.channels.create, {
      name: "general",
      workspaceId,
      type: "open",
    });

    // Before the scheduler runs, the channel exists and nobody is subscribed —
    // the two are separate transactions, which is the property that was
    // untestable while the shim collapsed them into one.
    expect(await subscribersOf(t, channelId)).toHaveLength(0);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const subscribedIds = new Set(
      (await subscribersOf(t, channelId)).map((row) => row.userId),
    );
    for (const userId of [ownerId, ...members]) {
      expect(subscribedIds.has(userId), `member ${userId} was skipped`).toBe(true);
    }
    expect(subscribedIds.size).toBe(members.length + 1);
  });
});
