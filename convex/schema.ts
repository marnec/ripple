import { defineSchema, defineTable, TableDefinition } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { WorkspaceRole } from "shared/enums/roles";
import { InviteStatus } from "shared/enums/inviteStatus";
import { Schema } from "shared/enums/schema";

// The schema is normally optional, but Convex Auth
// requires indexes defined on `authTables`.
// The schema provides more precise TypeScript types.
export default defineSchema({
  ...authTables,

  messages: defineTable({
    userId: v.id("users"),
    body: v.string(),
    channelId: v.id("channels"),
  }).index("by_channel", ["channelId"]),

  workspaces: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.id("users"),
  }),

  workspaceMembers: defineTable({
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    role: v.union(
      v.literal(WorkspaceRole.ADMIN),
      v.literal(WorkspaceRole.MEMBER),
    ),
  })
    .index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  channels: defineTable({
    name: v.string(),
    workspaceId: v.id("workspaces"),
  }).index("by_workspace", ["workspaceId"]),

  workspaceInvites: defineTable({
    workspaceId: v.id("workspaces"),
    email: v.string(),
    invitedBy: v.id("users"),
    status: v.union(
      v.literal(InviteStatus.PENDING),
      v.literal(InviteStatus.ACCEPTED),
      v.literal(InviteStatus.DECLINED),
    ),
  })
    .index("by_email", ["email"])
    .index("by_workspace", ["workspaceId"]),
} satisfies Record<keyof typeof Schema, TableDefinition>);
