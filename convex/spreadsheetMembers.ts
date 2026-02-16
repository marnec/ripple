import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { SpreadsheetRole } from "@shared/enums";
import { spreadsheetRoleSchema } from "./schema";

export const membersBySpreadsheet = query({
  args: { spreadsheetId: v.id("spreadsheets") },
  returns: v.array(v.object({
    _id: v.id("spreadsheetMembers"),
    _creationTime: v.number(),
    spreadsheetId: v.id("spreadsheets"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
    user: v.object({
      _id: v.id("users"),
      _creationTime: v.number(),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      image: v.optional(v.string()),
      isAnonymous: v.optional(v.boolean()),
    }),
  })),
  handler: async (ctx, { spreadsheetId }) => {
    const members = await ctx.db
      .query("spreadsheetMembers")
      .withIndex("by_spreadsheet", (q) => q.eq("spreadsheetId", spreadsheetId))
      .collect();

    return Promise.all(
      members.map(async (member) => {
        const user = await ctx.db.get(member.userId);
        if (!user) throw new ConvexError("User not found");
        return { ...member, user };
      }),
    );
  },
});

export const addMember = mutation({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, { spreadsheetId, userId }) => {
    const actingUserId = await getAuthUserId(ctx);
    if (!actingUserId) throw new ConvexError("Not authenticated");

    const spreadsheet = await ctx.db.get(spreadsheetId);
    if (!spreadsheet) throw new ConvexError("Spreadsheet not found");

    const membership = await ctx.db
      .query("spreadsheetMembers")
      .withIndex("by_spreadsheet_user", (q) =>
        q.eq("spreadsheetId", spreadsheetId).eq("userId", actingUserId),
      )
      .first();

    if (membership?.role !== SpreadsheetRole.ADMIN) {
      throw new ConvexError("You are not an admin of this spreadsheet");
    }

    const existingMember = await ctx.db
      .query("spreadsheetMembers")
      .withIndex("by_spreadsheet_user", (q) => q.eq("spreadsheetId", spreadsheetId).eq("userId", userId))
      .first();

    if (existingMember) return null;

    await ctx.db.insert("spreadsheetMembers", {
      spreadsheetId,
      userId,
      role: SpreadsheetRole.MEMBER,
    });

    const roleCount = spreadsheet.roleCount ?? { [SpreadsheetRole.ADMIN]: 1, [SpreadsheetRole.MEMBER]: 0 };
    await ctx.db.patch(spreadsheetId, {
      roleCount: {
        ...roleCount,
        [SpreadsheetRole.MEMBER]: roleCount[SpreadsheetRole.MEMBER] + 1,
      },
    });
    return null;
  },
});

export const removeMember = mutation({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, { spreadsheetId, userId }) => {
    const actingUserId = await getAuthUserId(ctx);
    if (!actingUserId) throw new ConvexError("Not authenticated");

    const spreadsheet = await ctx.db.get(spreadsheetId);
    if (!spreadsheet) throw new ConvexError("Spreadsheet not found");

    const membership = await ctx.db
      .query("spreadsheetMembers")
      .withIndex("by_spreadsheet_user", (q) =>
        q.eq("spreadsheetId", spreadsheetId).eq("userId", actingUserId),
      )
      .first();

    if (membership?.role !== SpreadsheetRole.ADMIN) {
      throw new ConvexError("You are not an admin of this spreadsheet");
    }

    const memberToRemove = await ctx.db
      .query("spreadsheetMembers")
      .withIndex("by_spreadsheet_user", (q) => q.eq("spreadsheetId", spreadsheetId).eq("userId", userId))
      .first();

    if (!memberToRemove) return null;

    await ctx.db.delete(memberToRemove._id);

    const roleCount = spreadsheet.roleCount ?? { [SpreadsheetRole.ADMIN]: 1, [SpreadsheetRole.MEMBER]: 0 };
    await ctx.db.patch(spreadsheetId, {
      roleCount: {
        ...roleCount,
        [memberToRemove.role]: roleCount[memberToRemove.role] - 1,
      },
    });
    return null;
  },
});

export const updateRole = mutation({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    userId: v.id("users"),
    role: spreadsheetRoleSchema,
  },
  returns: v.null(),
  handler: async (ctx, { spreadsheetId, userId, role }) => {
    const actingUserId = await getAuthUserId(ctx);
    if (!actingUserId) throw new ConvexError("Not authenticated");

    const spreadsheet = await ctx.db.get(spreadsheetId);
    if (!spreadsheet) throw new ConvexError("Spreadsheet not found");

    const membership = await ctx.db
      .query("spreadsheetMembers")
      .withIndex("by_spreadsheet_user", (q) =>
        q.eq("spreadsheetId", spreadsheetId).eq("userId", actingUserId),
      )
      .first();

    if (membership?.role !== SpreadsheetRole.ADMIN) {
      throw new ConvexError("You are not an admin of this spreadsheet");
    }

    const memberToUpdate = await ctx.db
      .query("spreadsheetMembers")
      .withIndex("by_spreadsheet_user", (q) => q.eq("spreadsheetId", spreadsheetId).eq("userId", userId))
      .first();

    if (!memberToUpdate) throw new ConvexError("Member not found");

    await ctx.db.patch(memberToUpdate._id, { role });

    const roleCount = spreadsheet.roleCount ?? { [SpreadsheetRole.ADMIN]: 1, [SpreadsheetRole.MEMBER]: 0 };
    await ctx.db.patch(spreadsheetId, {
      roleCount: {
        ...roleCount,
        [memberToUpdate.role]: roleCount[memberToUpdate.role] - 1,
        [role]: roleCount[role] + 1,
      },
    });
    return null;
  },
});

export const leave = mutation({
  args: { spreadsheetId: v.id("spreadsheets") },
  returns: v.null(),
  handler: async (ctx, { spreadsheetId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const member = await ctx.db
      .query("spreadsheetMembers")
      .withIndex("by_spreadsheet_user", (q) => q.eq("spreadsheetId", spreadsheetId).eq("userId", userId))
      .first();

    if (!member) throw new ConvexError("You are not a member of this spreadsheet");

    const spreadsheet = await ctx.db.get(spreadsheetId);
    if (!spreadsheet) throw new ConvexError("Spreadsheet not found");

    const roleCount = spreadsheet.roleCount ?? { [SpreadsheetRole.ADMIN]: 1, [SpreadsheetRole.MEMBER]: 0 };
    if (member.role === SpreadsheetRole.ADMIN && roleCount[SpreadsheetRole.ADMIN] === 1) {
      throw new ConvexError("Cannot leave as the only admin");
    }
    await ctx.db.delete(member._id);

    await ctx.db.patch(spreadsheetId, {
      roleCount: {
        ...roleCount,
        [member.role]: roleCount[member.role] - 1,
      },
    });
    return null;
  },
});
