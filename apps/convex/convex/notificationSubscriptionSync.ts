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
import type { Id } from "./_generated/dataModel";
import {
  BROADCAST_WORKSPACE_CATEGORIES,
  BROADCAST_CHANNEL_CATEGORIES,
  DEFAULT_PREFERENCES,
  DEFAULT_CHANNEL_CHAT_PREFERENCES,
  getCategoryScope,
  type NotificationCategory,
} from "@ripple/shared/notificationCategories";

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
    .withIndex("by_type_workspace", (q) =>
      q.eq("type", "open").eq("workspaceId", workspaceId),
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

export async function onPublicChannelInsert(
  ctx: Ctx,
  channelId: Id<"channels">,
  workspaceId: Id<"workspaces">,
): Promise<void> {
  const members = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();

  const prefs = await Promise.all(
    members.map((m) => getGlobalPrefs(ctx, m.userId)),
  );

  const inserts = members.flatMap((member, i) =>
    BROADCAST_CHANNEL_CATEGORIES
      .filter((cat) => isEnabled(prefs[i], cat, DEFAULT_CHANNEL_CHAT_PREFERENCES))
      .map((cat) =>
        insertSubscription(ctx, workspaceId, member.userId, cat, channelId),
      ),
  );

  await Promise.all(inserts);
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
          .withIndex("by_type_workspace", (q) =>
            q.eq("type", "open").eq("workspaceId", wsId),
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
 * When a channel changes type: open → closed, remove subscriptions
 * for users who are NOT explicit channel members.
 */
export async function onChannelMadePrivate(
  ctx: Ctx,
  channelId: Id<"channels">,
): Promise<void> {
  // Get all current subscriptions for this channel
  const subs = await ctx.db
    .query("notificationSubscriptions")
    .withIndex("by_scope_category", (q) => q.eq("scope", channelId as string))
    .collect();

  if (subs.length === 0) return;

  // Get explicit channel members
  const members = await ctx.db
    .query("channelMembers")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();
  const memberUserIds = new Set(members.map((m) => m.userId as string));

  // Delete subscriptions for non-members
  const toDelete = subs.filter((s) => !memberUserIds.has(s.userId as string));
  await Promise.all(toDelete.map((s) => ctx.db.delete(s._id)));
}

/**
 * When a channel changes type: closed → open, create subscriptions
 * for all workspace members who don't already have them.
 */
export async function onChannelMadePublic(
  ctx: Ctx,
  channelId: Id<"channels">,
  workspaceId: Id<"workspaces">,
): Promise<void> {
  const members = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();

  const prefs = await Promise.all(
    members.map((m) => getGlobalPrefs(ctx, m.userId)),
  );

  const inserts = members.flatMap((member, i) =>
    BROADCAST_CHANNEL_CATEGORIES
      .filter((cat) => isEnabled(prefs[i], cat, DEFAULT_CHANNEL_CHAT_PREFERENCES))
      .map((cat) =>
        insertSubscription(ctx, workspaceId, member.userId, cat, channelId),
      ),
  );

  await Promise.all(inserts);
}

// ── Channel Preference Sync ─────────────────────────────────────────

export async function onChannelPreferencesChange(
  ctx: Ctx,
  userId: Id<"users">,
  channelId: Id<"channels">,
  workspaceId: Id<"workspaces">,
  newPrefs: Record<string, unknown>,
): Promise<void> {
  await Promise.all(
    BROADCAST_CHANNEL_CATEGORIES.map((cat) => {
      const enabled = isEnabled(newPrefs, cat, DEFAULT_CHANNEL_CHAT_PREFERENCES);
      if (enabled) {
        return insertSubscription(ctx, workspaceId, userId, cat, channelId);
      } else {
        return deleteSubscription(ctx, userId, channelId, cat);
      }
    }),
  );
}
