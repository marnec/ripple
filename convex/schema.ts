import { authTables } from "@convex-dev/auth/server";
import { InviteStatus } from "@shared/enums/inviteStatus";
import { ChannelRole, WorkspaceRole } from "@shared/enums/roles";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
    role: v.union(...Object.values(WorkspaceRole).map((role) => v.literal(role))),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"])
    .index("by_workspace_user_and_role", ["workspaceId", "userId", "role"]),

  workspaceInvites: defineTable({
    workspaceId: v.id("workspaces"),
    email: v.string(),
    invitedBy: v.id("users"),
    status: v.union(...Object.values(InviteStatus).map((status) => v.literal(status))),
  })
    .index("by_email", ["email"])
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_by_email_by_status", ["workspaceId", "email", "status"])
    .index("by_email_and_status", ["email", "status"]),

  channels: defineTable({
    name: v.string(),
    workspaceId: v.id("workspaces"),
  }).index("by_workspace", ["workspaceId"]),

  channelMembers: defineTable({
    channelId: v.id("channels"),
    userId: v.id("users"),
    role: v.union(...Object.values(ChannelRole).map((role) => v.literal(role))),
  }).index("by_channel", ["channelId"]),

  signals: defineTable({
    roomId: v.optional(v.string()),
    peerId: v.string(),
    userId: v.id("users"),
    type: v.optional(v.string()),
    sdp: v.optional(v.string()),
    candidate: v.optional(v.any()),
  }),

  documents: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    tags: v.optional(v.array(v.string())),
  })
    .index("by_workspace", ["workspaceId"])
    .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),

  pushSubscriptions: defineTable({
    userId: v.id("users"),
    device: v.string(),
    endpoint: v.string(),
    expirationTime: v.union(v.number(), v.null()),
    keys: v.object({
      p256dh: v.string(),
      auth: v.string(),
    }),
  })
    .index("by_endpoint", ["endpoint"])
    .index("by_user", ["userId"]),
});
