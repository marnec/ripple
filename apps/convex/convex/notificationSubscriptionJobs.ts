/**
 * Scheduled internal mutations for bulk notification subscription operations.
 *
 * These run in their own transaction (scheduled via ctx.scheduler.runAfter(0))
 * to avoid resource contention on user-facing mutations. Triggers detect the
 * change and schedule the appropriate job instead of running the bulk work inline.
 */

import { v } from "convex/values";
import { internalMutation } from "./functions";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  onWorkspaceMemberInsert,
  onWorkspaceMemberDelete,
  onGlobalPreferencesChange,
  subscribeChannelMembersPage,
  unsubscribeNonChannelMembersPage,
} from "./notificationSubscriptionSync";

export const memberJoined = internalMutation({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Guard: if the member was removed before this scheduled mutation ran,
    // skip creating subscriptions to avoid orphaned rows.
    const stillMember = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.userId),
      )
      .first();
    if (!stillMember) return null;

    await onWorkspaceMemberInsert(ctx, args.userId, args.workspaceId);
    return null;
  },
});

export const memberLeft = internalMutation({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await onWorkspaceMemberDelete(ctx, args.userId, args.workspaceId);
    return null;
  },
});

/**
 * One page of the open-channel fanout. The `channel` guard is re-checked on
 * every page, not just the first: pages are separate transactions, so a channel
 * deleted or made private mid-drain stops the remaining work instead of
 * subscribing people to something that no longer exists.
 */
export const subscribeMembersPage = internalMutation({
  args: {
    channelId: v.id("channels"),
    workspaceId: v.id("workspaces"),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({ cursor: v.union(v.string(), v.null()), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.type !== "open") {
      return { cursor: null, isDone: true };
    }
    return subscribeChannelMembersPage(
      ctx,
      args.channelId,
      args.workspaceId,
      args.cursor,
    );
  },
});

/**
 * Drains the fanout a page at a time, holding the cursor between calls. Same
 * shape as `taskStatuses.syncTasksCompleted` and `tagSync.stripTagEverywhere`:
 * one scheduled entry point, one transaction per page.
 */
export const publicChannelCreated = internalAction({
  args: {
    channelId: v.id("channels"),
    workspaceId: v.id("workspaces"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let cursor: string | null = null;
    while (true) {
      const result: { cursor: string | null; isDone: boolean } = await ctx.runMutation(
        internal.notificationSubscriptionJobs.subscribeMembersPage,
        { channelId: args.channelId, workspaceId: args.workspaceId, cursor },
      );
      if (result.isDone) break;
      cursor = result.cursor;
    }
    return null;
  },
});

/**
 * One page of the going-private cleanup. Like its sibling above, the channel is
 * re-checked on every page: pages are separate transactions, so a channel made
 * public again mid-drain stops the removals rather than stripping subscriptions
 * the fanout is concurrently putting back.
 */
export const unsubscribeNonMembersPage = internalMutation({
  args: {
    channelId: v.id("channels"),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({ cursor: v.union(v.string(), v.null()), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.type === "open") {
      return { cursor: null, isDone: true };
    }
    return unsubscribeNonChannelMembersPage(ctx, args.channelId, args.cursor);
  },
});

export const channelMadePrivate = internalAction({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, args) => {
    let cursor: string | null = null;
    while (true) {
      const result: { cursor: string | null; isDone: boolean } = await ctx.runMutation(
        internal.notificationSubscriptionJobs.unsubscribeNonMembersPage,
        { channelId: args.channelId, cursor },
      );
      if (result.isDone) break;
      cursor = result.cursor;
    }
    return null;
  },
});

/**
 * A channel becoming public subscribes exactly the set a newly created open
 * channel does — the two handlers were byte-identical — so it runs the same
 * paged drain rather than keeping a second copy that could be batched on only
 * one side.
 */
export const channelMadePublic = publicChannelCreated;

export const globalPreferencesChanged = internalMutation({
  args: {
    userId: v.id("users"),
    oldPrefs: v.optional(v.any()),
    newPrefs: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await onGlobalPreferencesChange(
      ctx,
      args.userId,
      args.oldPrefs ?? null,
      args.newPrefs,
    );
    return null;
  },
});
