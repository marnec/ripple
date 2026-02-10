import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DiagramRole } from "@shared/enums";
import { diagramRoleSchema } from "./schema";

export const membersByDiagram = query({
  args: { diagramId: v.id("diagrams") },
  returns: v.array(v.object({
    _id: v.id("diagramMembers"),
    _creationTime: v.number(),
    diagramId: v.id("diagrams"),
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
  handler: async (ctx, { diagramId }) => {
    const members = await ctx.db
      .query("diagramMembers")
      .withIndex("by_diagram", (q) => q.eq("diagramId", diagramId))
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
    diagramId: v.id("diagrams"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, { diagramId, userId }) => {
    const actingUserId = await getAuthUserId(ctx);
    if (!actingUserId) throw new ConvexError("Not authenticated");

    const diagram = await ctx.db.get(diagramId);
    if (!diagram) throw new ConvexError("Diagram not found");

    const membership = await ctx.db
      .query("diagramMembers")
      .withIndex("by_diagram_user", (q) =>
        q.eq("diagramId", diagramId).eq("userId", actingUserId),
      )
      .first();

    if (membership?.role !== DiagramRole.ADMIN) {
      throw new ConvexError("You are not an admin of this diagram");
    }

    const existingMember = await ctx.db
      .query("diagramMembers")
      .withIndex("by_diagram_user", (q) => q.eq("diagramId", diagramId).eq("userId", userId))
      .first();

    if (existingMember) return null;

    await ctx.db.insert("diagramMembers", {
      diagramId,
      userId,
      role: DiagramRole.MEMBER,
    });

    const roleCount = diagram.roleCount ?? { [DiagramRole.ADMIN]: 1, [DiagramRole.MEMBER]: 0 };
    await ctx.db.patch(diagramId, {
      roleCount: {
        ...roleCount,
        [DiagramRole.MEMBER]: roleCount[DiagramRole.MEMBER] + 1,
      },
    });
    return null;
  },
});

export const removeMember = mutation({
  args: {
    diagramId: v.id("diagrams"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, { diagramId, userId }) => {
    const actingUserId = await getAuthUserId(ctx);
    if (!actingUserId) throw new ConvexError("Not authenticated");

    const diagram = await ctx.db.get(diagramId);
    if (!diagram) throw new ConvexError("Diagram not found");

    const membership = await ctx.db
      .query("diagramMembers")
      .withIndex("by_diagram_user", (q) =>
        q.eq("diagramId", diagramId).eq("userId", actingUserId),
      )
      .first();

    if (membership?.role !== DiagramRole.ADMIN) {
      throw new ConvexError("You are not an admin of this diagram");
    }

    const memberToRemove = await ctx.db
      .query("diagramMembers")
      .withIndex("by_diagram_user", (q) => q.eq("diagramId", diagramId).eq("userId", userId))
      .first();

    if (!memberToRemove) return null;

    await ctx.db.delete(memberToRemove._id);

    const roleCount = diagram.roleCount ?? { [DiagramRole.ADMIN]: 1, [DiagramRole.MEMBER]: 0 };
    await ctx.db.patch(diagramId, {
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
    diagramId: v.id("diagrams"),
    userId: v.id("users"),
    role: diagramRoleSchema,
  },
  returns: v.null(),
  handler: async (ctx, { diagramId, userId, role }) => {
    const actingUserId = await getAuthUserId(ctx);
    if (!actingUserId) throw new ConvexError("Not authenticated");

    const diagram = await ctx.db.get(diagramId);
    if (!diagram) throw new ConvexError("Diagram not found");

    const membership = await ctx.db
      .query("diagramMembers")
      .withIndex("by_diagram_user", (q) =>
        q.eq("diagramId", diagramId).eq("userId", actingUserId),
      )
      .first();

    if (membership?.role !== DiagramRole.ADMIN) {
      throw new ConvexError("You are not an admin of this diagram");
    }

    const memberToUpdate = await ctx.db
      .query("diagramMembers")
      .withIndex("by_diagram_user", (q) => q.eq("diagramId", diagramId).eq("userId", userId))
      .first();

    if (!memberToUpdate) throw new ConvexError("Member not found");

    await ctx.db.patch(memberToUpdate._id, { role });

    const roleCount = diagram.roleCount ?? { [DiagramRole.ADMIN]: 1, [DiagramRole.MEMBER]: 0 };
    await ctx.db.patch(diagramId, {
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
  args: { diagramId: v.id("diagrams") },
  returns: v.null(),
  handler: async (ctx, { diagramId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const member = await ctx.db
      .query("diagramMembers")
      .withIndex("by_diagram_user", (q) => q.eq("diagramId", diagramId).eq("userId", userId))
      .first();

    if (!member) throw new ConvexError("You are not a member of this diagram");

    const diagram = await ctx.db.get(diagramId);
    if (!diagram) throw new ConvexError("Diagram not found");

    const roleCount = diagram.roleCount ?? { [DiagramRole.ADMIN]: 1, [DiagramRole.MEMBER]: 0 };
    if (member.role === DiagramRole.ADMIN && roleCount[DiagramRole.ADMIN] === 1) {
      throw new ConvexError("Cannot leave as the only admin");
    }
    await ctx.db.delete(member._id);

    await ctx.db.patch(diagramId, {
      roleCount: {
        ...roleCount,
        [member.role]: roleCount[member.role] - 1,
      },
    });
    return null;
  },
});
