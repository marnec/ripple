/**
 * A channel notification preference is a standing grant, not a private setting.
 *
 * Saving `chatChannelMessage: true` fires a trigger that materializes a
 * `notificationSubscriptions` row, and the broadcast delivery path
 * (`notificationDelivery.getSubscribedUserIds` → `notifications.deliverPush` →
 * `sendPushToUsers`) reads that table blind — no channel lookup, no membership
 * check. So from the moment the row exists, every message posted in the channel
 * pushes its sender's name and the plaintext opening lines of its body to that
 * user.
 *
 * That makes `save` a read path on channel content, and it takes the **channel**
 * rule. Under the workspace rule it used to apply, any colleague could subscribe
 * themselves to a closed channel or someone else's DM — with no `channelMembers`
 * row, no UI trace, and nothing that would ever remove the subscription, since
 * `onChannelMemberDelete` only fires for people who were actually members.
 *
 * Three layers are covered here, because each one closes a different window:
 *   1. the writer (`save` / `get`) — refuses the caller,
 *   2. the sink (`onChannelPreferencesChange`) — refuses to materialize a
 *      subscription for a non-member, so a preference row written before the
 *      writer was fixed cannot re-arm itself,
 *   3. the repair (`migrations.unsubscribeNonMembersFromPrivateChannels`) —
 *      deletes subscription rows that are already there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelRole, WorkspaceRole } from "@ripple/shared/enums/roles";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "../convex/dbTriggers";
import {
  deliveredPushes,
  resetDeliveredPushes,
} from "./pushProbe";

// The observable for layer 3 is what reached push delivery — see pushProbe.ts.
vi.mock("../convex/utils/sendPushToUsers", async () => {
  const probe = await import("./pushProbe");
  return probe.pushDeliveryMock();
});

beforeEach(() => {
  resetDeliveredPushes();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

type TestCtx = ReturnType<typeof createTestContext>;

/**
 * A channel of the given type with `owner` as its only member, plus a second
 * workspace member (`outsider`) who has every workspace privilege and no
 * `channelMembers` row for it.
 */
async function setupPrivateChannel(t: TestCtx, type: "closed" | "dm") {
  const { userId: ownerId, workspaceId, asUser: asOwner } =
    await setupWorkspaceWithAdmin(t);

  const { userId: outsiderId, asUser: asOutsider } = await setupAuthenticatedUser(t, {
    name: "Nosy Colleague",
    email: "nosy@example.com",
  });

  const channelId = await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMembers", {
      userId: outsiderId,
      workspaceId,
      // Admin of the workspace — the point is that this is not enough.
      role: WorkspaceRole.ADMIN,
    });
    const id = await ctx.db.insert("channels", {
      name: type === "dm" ? "" : "leadership",
      workspaceId,
      type,
    });
    await ctx.db.insert("channelMembers", {
      channelId: id,
      workspaceId,
      userId: ownerId,
      role: ChannelRole.ADMIN,
    });
    return id;
  });

  return { ownerId, asOwner, outsiderId, asOutsider, workspaceId, channelId };
}

/** Subscription rows for a scope+category, as the delivery path would read them. */
async function subscribedUserIds(t: TestCtx, channelId: Id<"channels">) {
  return t.run(async (ctx) =>
    ctx.db
      .query("notificationSubscriptions")
      .withIndex("by_scope_category", (q) =>
        q.eq("scope", channelId as string).eq("category", "chatChannelMessage"),
      )
      .collect()
      .then((rows) => rows.map((r) => r.userId as string)),
  );
}

/**
 * Write the preference row straight to the table, bypassing `save`'s gate but
 * NOT the trigger — this is the row a caller could write before `save` applied
 * the channel rule, and the whole point of layer 2 is what the trigger does
 * with it. `t.run`'s bare `ctx.db` fires nothing, so the write goes through
 * `writerWithTriggers` (the same escape hatch notificationSubscriptions.test.ts
 * uses; safe here because there is no enclosing wrapped mutation to deadlock
 * against).
 */
async function seedPreference(
  t: TestCtx,
  opts: { userId: Id<"users">; channelId: Id<"channels">; chatChannelMessage?: boolean },
) {
  await t.run(async (ctx) => {
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.insert("channelNotificationPreferences", {
      userId: opts.userId,
      channelId: opts.channelId,
      chatMention: true,
      chatChannelMessage: opts.chatChannelMessage ?? true,
    });
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

/* ── Layer 1: the writer ──────────────────────────────────────────── */

describe("channelNotificationPreferences.save — the channel rule", () => {
  it.each(["closed", "dm"] as const)(
    "refuses a workspace member with no membership of a %s channel",
    async (type) => {
      const t = createTestContext();
      const { asOutsider, channelId } = await setupPrivateChannel(t, type);

      await expect(
        asOutsider.mutation(api.channelNotificationPreferences.save, {
          channelId,
          chatMention: true,
          chatChannelMessage: true,
        }),
        // convex/channelNotificationPreferences.ts:41 — gated on the workspace rule
      ).rejects.toThrow();

      const rows = await t.run((ctx) =>
        ctx.db.query("channelNotificationPreferences").collect(),
      );
      expect(rows, "no preference row may be written").toHaveLength(0);
      expect(await subscribedUserIds(t, channelId)).toEqual([]);
    },
  );

  it("still lets an actual channel member save", async () => {
    const t = createTestContext();
    const { asOwner, ownerId, channelId } = await setupPrivateChannel(t, "closed");

    await asOwner.mutation(api.channelNotificationPreferences.save, {
      channelId,
      chatMention: true,
      chatChannelMessage: true,
    });

    expect(await subscribedUserIds(t, channelId)).toContain(ownerId);
  });

  it("still lets any workspace member save on an open channel", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await t.run((ctx) =>
      ctx.db.insert("channels", { name: "general", workspaceId, type: "open" as const }),
    );

    await asUser.mutation(api.channelNotificationPreferences.save, {
      channelId,
      chatMention: true,
      chatChannelMessage: true,
    });

    expect(await subscribedUserIds(t, channelId)).toContain(userId);
  });

  it("get returns null rather than a preference for a non-member", async () => {
    const t = createTestContext();
    const { asOutsider, outsiderId, channelId } = await setupPrivateChannel(t, "closed");
    await seedPreference(t, { userId: outsiderId, channelId });

    expect(
      await asOutsider.query(api.channelNotificationPreferences.get, { channelId }),
    ).toBeNull();
  });
});

/* ── Layer 2: the sink ────────────────────────────────────────────── */

describe("onChannelPreferencesChange — subscriptions need channel membership", () => {
  it("does not materialize a subscription from a pre-gate preference row", async () => {
    const t = createTestContext();
    const { outsiderId, channelId } = await setupPrivateChannel(t, "closed");

    await seedPreference(t, { userId: outsiderId, channelId });

    expect(await subscribedUserIds(t, channelId)).not.toContain(outsiderId);
  });

  it("tears down a stale subscription on the next preference write", async () => {
    const t = createTestContext();
    const { outsiderId, workspaceId, channelId } = await setupPrivateChannel(t, "closed");

    // The subscription row as the pre-fix writer would have left it...
    await t.run((ctx) =>
      ctx.db.insert("notificationSubscriptions", {
        workspaceId,
        userId: outsiderId,
        category: "chatChannelMessage",
        scope: channelId as string,
      }),
    );
    // ...then any later preference write for the same channel.
    await seedPreference(t, { userId: outsiderId, channelId });

    // The unreachable case falls through to `deleteSubscription`, so the
    // trigger fired by that insert removes the stale grant rather than
    // merely declining to add one.
    expect(await subscribedUserIds(t, channelId)).not.toContain(outsiderId);
  });

  it("keeps materializing for a real channel member", async () => {
    const t = createTestContext();
    const { ownerId, channelId } = await setupPrivateChannel(t, "closed");

    await seedPreference(t, { userId: ownerId, channelId });

    expect(await subscribedUserIds(t, channelId)).toContain(ownerId);
  });
});

/* ── Layer 3: what actually reaches a lock screen ─────────────────── */

describe("chatChannelMessage broadcast — who receives the message body", () => {
  it("does not push a closed-channel message to a self-subscribed non-member", async () => {
    const t = createTestContext();
    const { asOwner, outsiderId, workspaceId, channelId } =
      await setupPrivateChannel(t, "closed");

    // The strongest form of the attack: the subscription row already exists,
    // written before any of the three layers were in place.
    await t.run((ctx) =>
      ctx.db.insert("notificationSubscriptions", {
        workspaceId,
        userId: outsiderId,
        category: "chatChannelMessage",
        scope: channelId as string,
      }),
    );
    await t.mutation(internal.migrations.unsubscribeNonMembersFromPrivateChannels, {
      cursor: null,
      batchSize: 100,
    });

    await asOwner.mutation(api.messages.send, {
      channelId,
      isomorphicId: "broadcast-1",
      body: JSON.stringify([
        { type: "paragraph", content: [{ type: "text", text: "layoff list attached", styles: {} }] },
      ]),
      plainText: "layoff list attached",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    for (const push of deliveredPushes) {
      expect(push.recipientIds).not.toContain(outsiderId);
      expect(push.body).not.toContain("layoff list attached");
    }
  });
});

/* ── The repair itself ────────────────────────────────────────────── */

describe("migrations.unsubscribeNonMembersFromPrivateChannels", () => {
  async function seedSubscription(
    t: TestCtx,
    opts: { workspaceId: Id<"workspaces">; userId: Id<"users">; scope: string },
  ) {
    await t.run((ctx) =>
      ctx.db.insert("notificationSubscriptions", {
        workspaceId: opts.workspaceId,
        userId: opts.userId,
        category: "chatChannelMessage",
        scope: opts.scope,
      }),
    );
  }

  async function runRepair(t: TestCtx) {
    await t.mutation(internal.migrations.unsubscribeNonMembersFromPrivateChannels, {
      cursor: null,
      batchSize: 100,
    });
    await t.finishAllScheduledFunctions(() => {});
  }

  it("deletes a private-channel subscription held by a non-member", async () => {
    const t = createTestContext();
    const { ownerId, outsiderId, workspaceId, channelId } =
      await setupPrivateChannel(t, "closed");
    await seedSubscription(t, { workspaceId, userId: outsiderId, scope: channelId });
    await seedSubscription(t, { workspaceId, userId: ownerId, scope: channelId });

    await runRepair(t);

    const remaining = await subscribedUserIds(t, channelId);
    expect(remaining).not.toContain(outsiderId);
    expect(remaining, "a real member's subscription must survive").toContain(ownerId);
  });

  it("leaves open-channel subscriptions alone", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const channelId = await t.run((ctx) =>
      ctx.db.insert("channels", { name: "general", workspaceId, type: "open" as const }),
    );
    // No channelMembers row by design — open channels admit every workspace
    // member, which is exactly what `subscribeChannelMembersPage` writes.
    await seedSubscription(t, { workspaceId, userId, scope: channelId });

    await runRepair(t);

    expect(await subscribedUserIds(t, channelId)).toContain(userId);
  });

  it("leaves workspace-scoped subscriptions alone", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    await t.run((ctx) =>
      ctx.db.insert("notificationSubscriptions", {
        workspaceId,
        userId,
        category: "documentCreated",
        scope: workspaceId as string,
      }),
    );

    await runRepair(t);

    const rows = await t.run((ctx) =>
      ctx.db.query("notificationSubscriptions").collect(),
    );
    expect(rows).toHaveLength(1);
  });
});
