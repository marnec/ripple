/**
 * Notification Subscription Sync
 *
 * Maintains the `notificationSubscriptions` materialized view — a pub/sub
 * registry that answers "who wants category X in scope Y?" with a single
 * indexed query at delivery time.
 *
 * Rows exist for enabled subscriptions only. No row = notification disabled.
 *
 * Called from triggers in dbTriggers.ts whenever membership or preference
 * tables change.
 */

import type { DatabaseWriter } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  BROADCAST_WORKSPACE_CATEGORIES,
  BROADCAST_CHANNEL_CATEGORIES,
  DEFAULT_PREFERENCES,
  DEFAULT_CHANNEL_CHAT_PREFERENCES,
  getCategoryScope,
  type NotificationCategory,
} from "@ripple/shared/notificationCategories";

import { isPublicChannel } from "@ripple/shared/channel";
import { ChannelKind, ChannelVisibility } from "@ripple/shared/enums";
type Ctx = { db: DatabaseWriter };

// ── Helpers ─────────────────────────────────────────────────────────

async function insertSubscription(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
  category: string,
  scope: string,
) {
  const existing = await ctx.db
    .query("notificationSubscriptions")
    .withIndex("by_user_scope_category", (q) =>
      q.eq("userId", userId).eq("scope", scope).eq("category", category),
    )
    .first();
  if (existing) return;
  await ctx.db.insert("notificationSubscriptions", {
    workspaceId,
    userId,
    category,
    scope,
  });
}

async function deleteSubscription(
  ctx: Ctx,
  userId: Id<"users">,
  scope: string,
  category: string,
) {
  const existing = await ctx.db
    .query("notificationSubscriptions")
    .withIndex("by_user_scope_category", (q) =>
      q.eq("userId", userId).eq("scope", scope).eq("category", category),
    )
    .first();
  if (existing) await ctx.db.delete(existing._id);
}

async function isChannelMember(
  ctx: Ctx,
  channelId: Id<"channels">,
  userId: Id<"users">,
): Promise<boolean> {
  const row = await ctx.db
    .query("channelMembers")
    .withIndex("by_channel_user", (q) =>
      q.eq("channelId", channelId).eq("userId", userId),
    )
    .first();
  return row !== null;
}

async function getGlobalPrefs(ctx: Ctx, userId: Id<"users">) {
  return await ctx.db
    .query("notificationPreferences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

function isEnabled(
  prefs: Record<string, unknown> | null,
  category: NotificationCategory,
  defaults: Record<string, boolean>,
): boolean {
  if (!prefs) return defaults[category] ?? true;
  const val = prefs[category];
  if (typeof val === "boolean") return val;
  return defaults[category] ?? true;
}

// ── Workspace Member Sync ───────────────────────────────────────────

export async function onWorkspaceMemberInsert(
  ctx: Ctx,
  userId: Id<"users">,
  workspaceId: Id<"workspaces">,
): Promise<void> {
  const globalPrefs = await getGlobalPrefs(ctx, userId);

  // Workspace-scoped broadcast categories
  const wsInserts = BROADCAST_WORKSPACE_CATEGORIES
    .filter((cat) => isEnabled(globalPrefs, cat, DEFAULT_PREFERENCES))
    .map((cat) => insertSubscription(ctx, workspaceId, userId, cat, workspaceId));

  // Channel-scoped broadcast categories (open channels only — closed/dm
  // channels are handled by the channelMembers INSERT trigger)
  const publicChannels = await ctx.db
    .query("channels")
    .withIndex("by_kind_visibility_workspace", (q) =>
      q
        .eq("kind", ChannelKind.CHANNEL)
        .eq("visibility", ChannelVisibility.PUBLIC)
        .eq("workspaceId", workspaceId),
    )
    .collect();

  const channelInserts = publicChannels.flatMap((channel) =>
    BROADCAST_CHANNEL_CATEGORIES
      .filter((cat) => isEnabled(globalPrefs, cat, DEFAULT_CHANNEL_CHAT_PREFERENCES))
      .map((cat) => insertSubscription(ctx, workspaceId, userId, cat, channel._id)),
  );

  await Promise.all([...wsInserts, ...channelInserts]);
}

export async function onWorkspaceMemberDelete(
  ctx: Ctx,
  userId: Id<"users">,
  workspaceId: Id<"workspaces">,
): Promise<void> {
  const rows = await ctx.db
    .query("notificationSubscriptions")
    .withIndex("by_user_workspace", (q) =>
      q.eq("userId", userId).eq("workspaceId", workspaceId),
    )
    .collect();
  await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
}

// ── Channel Member Sync ─────────────────────────────────────────────

export async function onChannelMemberInsert(
  ctx: Ctx,
  userId: Id<"users">,
  channelId: Id<"channels">,
  workspaceId: Id<"workspaces">,
): Promise<void> {
  const channelPrefs = await ctx.db
    .query("channelNotificationPreferences")
    .withIndex("by_user_channel", (q) =>
      q.eq("userId", userId).eq("channelId", channelId),
    )
    .unique();

  const globalPrefs = channelPrefs ? null : await getGlobalPrefs(ctx, userId);

  await Promise.all(
    BROADCAST_CHANNEL_CATEGORIES
      .filter((cat) => {
        if (channelPrefs) return channelPrefs[cat];
        return isEnabled(globalPrefs, cat, DEFAULT_CHANNEL_CHAT_PREFERENCES);
      })
      .map((cat) => insertSubscription(ctx, workspaceId, userId, cat, channelId)),
  );
}

export async function onChannelMemberDelete(
  ctx: Ctx,
  userId: Id<"users">,
  channelId: string,
): Promise<void> {
  const rows = await ctx.db
    .query("notificationSubscriptions")
    .withIndex("by_user_scope", (q) =>
      q.eq("userId", userId).eq("scope", channelId),
    )
    .collect();
  await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
}

// ── Channel Sync ────────────────────────────────────────────────────

/**
 * Rows of `workspaceMembers` handled per transaction by the open-channel fanout.
 *
 * This is the only subscription path whose cost scales with workspace size:
 * every member needs a preference read and a subscription insert, so an unpaged
 * version puts O(members) reads and writes in one transaction and eventually
 * trips Convex's per-transaction caps — turning "someone created a channel"
 * into a thrown error at a size nobody can predict from reading the code.
 */
export const SUBSCRIPTION_PAGE_SIZE = 200;

/**
 * Subscribe one page of workspace members to an open channel.
 *
 * Returns where to resume rather than looping internally, so the caller owns the
 * transaction boundary — see `notificationSubscriptionJobs.ts`. This one needs a
 * real cursor, unlike the task and tag drains: those advance because each batch
 * patches the very column it queries on, whereas this batch writes to a
 * different table entirely and leaves `workspaceMembers` untouched.
 *
 * `insertSubscription` no-ops when the row already exists, so a replayed page is
 * harmless — a retry cannot double-subscribe anyone.
 */
export async function subscribeChannelMembersPage(
  ctx: Ctx,
  channelId: Id<"channels">,
  workspaceId: Id<"workspaces">,
  cursor: string | null,
): Promise<{ cursor: string | null; isDone: boolean }> {
  const page = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .paginate({ numItems: SUBSCRIPTION_PAGE_SIZE, cursor });

  const prefs = await Promise.all(
    page.page.map((m) => getGlobalPrefs(ctx, m.userId)),
  );

  await Promise.all(
    page.page.flatMap((member, i) =>
      BROADCAST_CHANNEL_CATEGORIES
        .filter((cat) => isEnabled(prefs[i], cat, DEFAULT_CHANNEL_CHAT_PREFERENCES))
        .map((cat) =>
          insertSubscription(ctx, workspaceId, member.userId, cat, channelId),
        ),
    ),
  );

  return { cursor: page.continueCursor, isDone: page.isDone };
}


// ── Global Preference Sync ──────────────────────────────────────────

export async function onGlobalPreferencesChange(
  ctx: Ctx,
  userId: Id<"users">,
  oldPrefs: Record<string, unknown> | null,
  newPrefs: Record<string, unknown>,
): Promise<void> {
  // Only broadcast categories need subscription table updates.
  const allBroadcast: NotificationCategory[] = [
    ...BROADCAST_WORKSPACE_CATEGORIES,
    ...BROADCAST_CHANNEL_CATEGORIES,
  ];

  const changed = allBroadcast.filter((cat) => {
    const oldVal = isEnabled(oldPrefs, cat, DEFAULT_PREFERENCES);
    const newVal = isEnabled(newPrefs, cat, DEFAULT_PREFERENCES);
    return oldVal !== newVal;
  });

  if (changed.length === 0) return;

  const memberships = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  for (const cat of changed) {
    const nowEnabled = isEnabled(newPrefs, cat, DEFAULT_PREFERENCES);
    const scope = getCategoryScope(cat);

    for (const membership of memberships) {
      const wsId = membership.workspaceId;

      if (scope === "workspace") {
        if (nowEnabled) {
          await insertSubscription(ctx, wsId, userId, cat, wsId);
        } else {
          await deleteSubscription(ctx, userId, wsId, cat);
        }
      } else if (scope === "channel") {
        // Discover channels from actual membership data, not existing subs.
        // Open channels: all workspace members are subscribed.
        const publicChannels = await ctx.db
          .query("channels")
          .withIndex("by_kind_visibility_workspace", (q) =>
            q
              .eq("kind", ChannelKind.CHANNEL)
              .eq("visibility", ChannelVisibility.PUBLIC)
              .eq("workspaceId", wsId),
          )
          .collect();
        // Closed/DM channels: only explicit memberships.
        const privateMemberships = await ctx.db
          .query("channelMembers")
          .withIndex("by_workspace_user", (q) =>
            q.eq("workspaceId", wsId).eq("userId", userId),
          )
          .collect();

        const channelIds = new Set([
          ...publicChannels.map((c) => c._id as string),
          ...privateMemberships.map((m) => m.channelId as string),
        ]);

        for (const channelId of channelIds) {
          // Skip if user has channel-specific override
          const override = await ctx.db
            .query("channelNotificationPreferences")
            .withIndex("by_user_channel", (q) =>
              q.eq("userId", userId).eq("channelId", channelId as Id<"channels">),
            )
            .first();
          if (override) continue;

          if (nowEnabled) {
            await insertSubscription(ctx, wsId, userId, cat, channelId);
          } else {
            await deleteSubscription(ctx, userId, channelId, cat);
          }
        }
      }
    }
  }
}

// ── Channel Preference Sync ─────────────────────────────────────────

// ── Channel Visibility Toggle ────────────────────────────────────────

/**
 * Drop one page of subscriptions belonging to users who are not members of a
 * channel that has just gone private.
 *
 * Paginated for the same reason the fanout is — the subscription set on an open
 * channel is the whole workspace — and with a cursor for a reason that is *not*
 * the same. This one deletes rows out of the very index it walks, which looks
 * self-advancing, but the rows it keeps (the real channel members) stay in the
 * range: a `.take()` loop would hand back those keepers forever and never reach
 * the deletable rows behind them.
 *
 * Membership is a point lookup per row rather than one `by_channel` collect, so
 * a page costs a bounded number of reads regardless of how many members the
 * channel has.
 */
export async function unsubscribeNonChannelMembersPage(
  ctx: Ctx,
  channelId: Id<"channels">,
  cursor: string | null,
): Promise<{ cursor: string | null; isDone: boolean }> {
  const page = await ctx.db
    .query("notificationSubscriptions")
    .withIndex("by_scope_category", (q) => q.eq("scope", channelId as string))
    .paginate({ numItems: SUBSCRIPTION_PAGE_SIZE, cursor });

  await Promise.all(
    page.page.map(async (sub) => {
      const membership = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", sub.userId),
        )
        .first();
      if (!membership) await ctx.db.delete(sub._id);
    }),
  );

  return { cursor: page.continueCursor, isDone: page.isDone };
}


// ── Channel Preference Sync ─────────────────────────────────────────

/**
 * Every other path into this file derives channel reachability from membership
 * data — `onWorkspaceMemberInsert` takes open channels only, `onChannelMemberInsert`
 * needs the `channelMembers` row to exist, `onGlobalPreferencesChange` unions
 * open channels with explicit memberships. This one used to trust the
 * preference row by itself, which made a `channelNotificationPreferences` write
 * the one way to mint a subscription to a channel you cannot read.
 *
 * The public writer (`channelNotificationPreferences.save`) now applies the
 * channel rule, so this is the second line: it keeps a row written *before* that
 * gate existed from re-materializing a subscription, and — because the
 * unreachable case falls through to `deleteSubscription` rather than merely
 * skipping the insert — any later preference write actively tears down a stale
 * one.
 */
export async function onChannelPreferencesChange(
  ctx: Ctx,
  userId: Id<"users">,
  channel: Doc<"channels">,
  newPrefs: Record<string, unknown>,
): Promise<void> {
  const channelId = channel._id;
  const mayReceive =
    isPublicChannel(channel) || (await isChannelMember(ctx, channelId, userId));

  await Promise.all(
    BROADCAST_CHANNEL_CATEGORIES.map((cat) => {
      const enabled =
        mayReceive && isEnabled(newPrefs, cat, DEFAULT_CHANNEL_CHAT_PREFERENCES);
      if (enabled) {
        return insertSubscription(ctx, channel.workspaceId, userId, cat, channelId);
      } else {
        return deleteSubscription(ctx, userId, channelId, cat);
      }
    }),
  );
}
