import { authTables } from "@convex-dev/auth/server";
import { InviteStatus } from "@shared/enums/inviteStatus";
import { ChannelRole, DocumentRole, WorkspaceRole } from "@shared/enums/roles";
import { defineSchema, defineTable } from "convex/server";
import { v, VFloat64 } from "convex/values";

export const channelRoleSchema = v.union(
  ...Object.values(ChannelRole).map((role) => v.literal(role)),
);

export const documentRoleSchema = v.union(
  ...Object.values(DocumentRole).map((role) => v.literal(role)),
);

// The schema is normally optional, but Convex Auth
// requires indexes defined on `authTables`.
// The schema provides more precise TypeScript types.
export default defineSchema({
  ...authTables,

  messages: defineTable({
    userId: v.id("users"),
    isomorphicId: v.string(), // to use as key in react (client generated, same in optimistic update and db)
    body: v.string(),
    plainText: v.string(), // to filter messages
    channelId: v.id("channels"),
    deleted: v.boolean(),
  })
    .index("by_channel", ["channelId"])
    .index("undeleted_by_channel", ["channelId", "deleted"])
    .searchIndex("by_text", { searchField: "plainText", filterFields: ["channelId"] }),

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
    roleCount: v.object({
      [ChannelRole.ADMIN]: v.number(),
      [ChannelRole.MEMBER]: v.number(),
    } satisfies Record<
      (typeof ChannelRole)[keyof typeof ChannelRole],
      VFloat64<number, "required">
    >),
  }).index("by_workspace", ["workspaceId"]),

  channelMembers: defineTable({
    channelId: v.id("channels"),
    userId: v.id("users"),
    role: channelRoleSchema,
  })
    .index("by_user", ["userId"])
    .index("by_channel", ["channelId"])
    .index("by_channel_user", ["channelId", "userId"])
    .index("by_channel_role", ["channelId", "role"]),

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
    roleCount: v.object({
      [DocumentRole.ADMIN]: v.number(),
      [DocumentRole.MEMBER]: v.number(),
    } satisfies Record<
      (typeof DocumentRole)[keyof typeof DocumentRole],
      VFloat64<number, "required">
    >),
  })
    .index("by_workspace", ["workspaceId"])
    .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),

  documentMembers: defineTable({
    documentId: v.id("documents"),
    userId: v.id("users"),
    role: documentRoleSchema,
  })
    .index("by_user", ["userId"])
    .index("by_document", ["documentId"])
    .index("by_document_user", ["documentId", "userId"])
    .index("by_document_role", ["documentId", "role"]),

  diagrams: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    tags: v.optional(v.array(v.string())),
    content: v.optional(v.string()),
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
