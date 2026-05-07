import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./authHelpers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "./dbTriggers";
import type { EmailCapableCategory } from "@ripple/shared/notificationCategories";
import { prefersChannel } from "./utils/notificationChannels";

// Re-exported so callers can keep importing from this module's public
// surface; the implementation lives in utils/notificationChannels for
// test ergonomics (no Convex harness boot needed).
export { prefersChannel };

// Event categories store either a flat boolean (legacy) or `{ push, email }`.
// Keeping the union here matches the schema so writes from `save` validate.
const eventChannelPref = v.union(
  v.boolean(),
  v.object({ push: v.boolean(), email: v.boolean() }),
);

const preferencesValidator = v.object({
  _id: v.id("notificationPreferences"),
  _creationTime: v.number(),
  userId: v.id("users"),
  chatMention: v.boolean(),
  chatChannelMessage: v.boolean(),
  taskAssigned: v.boolean(),
  taskDescriptionMention: v.boolean(),
  taskCommentMention: v.boolean(),
  taskComment: v.boolean(),
  taskStatusChange: v.boolean(),
  documentMention: v.boolean(),
  documentCreated: v.boolean(),
  documentDeleted: v.boolean(),
  spreadsheetCreated: v.boolean(),
  spreadsheetDeleted: v.boolean(),
  diagramCreated: v.boolean(),
  diagramDeleted: v.boolean(),
  projectCreated: v.boolean(),
  projectDeleted: v.boolean(),
  channelCreated: v.boolean(),
  channelDeleted: v.boolean(),
  channelJoinRequest: v.optional(v.boolean()),
  channelJoinDecision: v.optional(v.boolean()),
  eventInvited: v.optional(eventChannelPref),
  eventUpdated: v.optional(eventChannelPref),
  eventCancelled: v.optional(eventChannelPref),
  eventResponseChanged: v.optional(v.boolean()),
});

export const get = query({
  args: {},
  returns: v.union(preferencesValidator, v.null()),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);

    return await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const save = mutation({
  args: {
    chatMention: v.boolean(),
    chatChannelMessage: v.boolean(),
    taskAssigned: v.boolean(),
    taskDescriptionMention: v.boolean(),
    taskCommentMention: v.boolean(),
    taskComment: v.boolean(),
    taskStatusChange: v.boolean(),
    documentMention: v.boolean(),
    documentCreated: v.boolean(),
    documentDeleted: v.boolean(),
    spreadsheetCreated: v.boolean(),
    spreadsheetDeleted: v.boolean(),
    diagramCreated: v.boolean(),
    diagramDeleted: v.boolean(),
    projectCreated: v.boolean(),
    projectDeleted: v.boolean(),
    channelCreated: v.boolean(),
    channelDeleted: v.boolean(),
    channelJoinRequest: v.optional(v.boolean()),
    channelJoinDecision: v.optional(v.boolean()),
    eventInvited: v.optional(eventChannelPref),
    eventUpdated: v.optional(eventChannelPref),
    eventCancelled: v.optional(eventChannelPref),
    eventResponseChanged: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const existing = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    if (existing) {
      await db.patch(existing._id, args);
    } else {
      await db.insert("notificationPreferences", { userId, ...args });
    }

    return null;
  },
});

/**
 * Returns the subset of `userIds` whose email preference for the given
 * email-capable category is on (default ON when the row or field is
 * missing). Used by calendar event mutations to decide who gets an
 * email + ICS in addition to push.
 */
export const filterUsersWantingEmail = internalQuery({
  args: {
    userIds: v.array(v.id("users")),
    category: v.union(
      v.literal("eventInvited"),
      v.literal("eventUpdated"),
      v.literal("eventCancelled"),
    ),
  },
  returns: v.array(v.id("users")),
  handler: async (ctx, { userIds, category }) => {
    const cat = category as EmailCapableCategory;
    const rows = await Promise.all(
      userIds.map((uid: Id<"users">) =>
        ctx.db
          .query("notificationPreferences")
          .withIndex("by_user", (q) => q.eq("userId", uid))
          .unique(),
      ),
    );
    return userIds.filter((_, i) => prefersChannel(rows[i], cat, "email"));
  },
});

export const getForUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(preferencesValidator, v.null()),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const getForUsers = internalQuery({
  args: { userIds: v.array(v.id("users")) },
  returns: v.array(v.union(preferencesValidator, v.null())),
  handler: async (ctx, { userIds }) => {
    return await Promise.all(
      userIds.map((userId) =>
        ctx.db
          .query("notificationPreferences")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .unique(),
      ),
    );
  },
});
