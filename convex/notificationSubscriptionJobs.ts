/**
 * Scheduled internal mutations for bulk notification subscription operations.
 *
 * These run in their own transaction (scheduled via ctx.scheduler.runAfter(0))
 * to avoid resource contention on user-facing mutations. Triggers detect the
 * change and schedule the appropriate job instead of running the bulk work inline.
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  onWorkspaceMemberInsert,
  onWorkspaceMemberDelete,
  onPublicChannelInsert,
  onChannelMadePrivate,
  onChannelMadePublic,
  onGlobalPreferencesChange,
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

export const publicChannelCreated = internalMutation({
  args: {
    channelId: v.id("channels"),
    workspaceId: v.id("workspaces"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || !channel.isPublic) return null;
    await onPublicChannelInsert(ctx, args.channelId, args.workspaceId);
    return null;
  },
});

export const channelMadePrivate = internalMutation({
  args: {
    channelId: v.id("channels"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.isPublic) return null;
    await onChannelMadePrivate(ctx, args.channelId);
    return null;
  },
});

export const channelMadePublic = internalMutation({
  args: {
    channelId: v.id("channels"),
    workspaceId: v.id("workspaces"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || !channel.isPublic) return null;
    await onChannelMadePublic(ctx, args.channelId, args.workspaceId);
    return null;
  },
});

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
