import { authTables } from "@convex-dev/auth/server";
import { InviteStatus } from "@shared/enums/inviteStatus";
import { ChannelRole, WorkspaceRole } from "@shared/enums/roles";
import { defineSchema, defineTable } from "convex/server";
import { v, VFloat64 } from "convex/values";

export const channelRoleSchema = v.union(
  ...Object.values(ChannelRole).map((role) => v.literal(role)),
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
    replyToId: v.optional(v.id("messages")),
  })
    .index("by_channel", ["channelId"])
    .index("undeleted_by_channel", ["channelId", "deleted"])
    .searchIndex("by_text", { searchField: "plainText", filterFields: ["channelId"] }),

  messageReactions: defineTable({
    messageId: v.id("messages"),
    userId: v.id("users"),
    emoji: v.string(), // unified emoji code (e.g., "1f44d")
    emojiNative: v.string(), // rendered emoji character (e.g., "👍")
  })
    .index("by_message", ["messageId"])
    .index("by_message_emoji_user", ["messageId", "emoji", "userId"]),

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
    isPublic: v.boolean(),
    roleCount: v.object({
      [ChannelRole.ADMIN]: v.number(),
      [ChannelRole.MEMBER]: v.number(),
    } satisfies Record<
      (typeof ChannelRole)[keyof typeof ChannelRole],
      VFloat64<number, "required">
    >),
  })
  .index("by_workspace", ["workspaceId"])
  .index("by_isPublicInWorkspace", ["isPublic", "workspaceId"]),


  channelMembers: defineTable({
    channelId: v.id("channels"),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: channelRoleSchema,
  })
    .index("by_user", ["userId"])
    .index("by_channel", ["channelId"])
    .index("by_channel_user", ["channelId", "userId"])
    .index("by_workspace_user", ["workspaceId", "userId"])
    .index("by_channel_role", ["channelId", "role"]),

  documents: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    tags: v.optional(v.array(v.string())),
    yjsSnapshotId: v.optional(v.id("_storage")),
  })
    .index("by_workspace", ["workspaceId"])
    .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),

  diagrams: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    tags: v.optional(v.array(v.string())),
    yjsSnapshotId: v.optional(v.id("_storage")),
  })
    .index("by_workspace", ["workspaceId"])
    .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),

  spreadsheets: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    tags: v.optional(v.array(v.string())),
    yjsSnapshotId: v.optional(v.id("_storage")),
  })
    .index("by_workspace", ["workspaceId"])
    .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),

  projects: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    color: v.string(), // Tailwind color class like "bg-blue-500"
    workspaceId: v.id("workspaces"),
    creatorId: v.id("users"), // the user who created the project (the admin)
  })
    .index("by_workspace", ["workspaceId"])
    .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),

  taskStatuses: defineTable({
    projectId: v.id("projects"),
    name: v.string(), // "To Do", "In Progress", "Done"
    color: v.string(), // Tailwind class like "bg-gray-500"
    order: v.number(), // display order (0, 1, 2...)
    isDefault: v.boolean(), // marks the default status for new tasks (only one per project)
    isCompleted: v.boolean(), // when true, tasks with this status are considered completed
  })
    .index("by_project", ["projectId"])
    .index("by_project_order", ["projectId", "order"]),

  tasks: defineTable({
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"), // denormalized for cross-project queries
    title: v.string(),
    statusId: v.id("taskStatuses"), // reference to customizable status
    assigneeId: v.optional(v.id("users")), // single assignee
    priority: v.union(
      v.literal("urgent"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low")
    ),
    labels: v.optional(v.array(v.string())), // freeform string labels (matches documents.tags pattern)
    completed: v.boolean(), // denormalized from status.isCompleted for efficient filtering
    creatorId: v.id("users"), // who created the task
    position: v.optional(v.string()), // fractional index for ordering within status column
    yjsSnapshotId: v.optional(v.id("_storage")),
  })
    .index("by_project", ["projectId"])
    .index("by_project_completed", ["projectId", "completed"])
    .index("by_assignee", ["assigneeId"])
    .index("by_assignee_completed", ["assigneeId", "completed"])
    .index("by_project_status", ["projectId", "statusId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_project_status_position", ["projectId", "statusId", "position"]),

  taskComments: defineTable({
    taskId: v.id("tasks"),
    userId: v.id("users"),
    body: v.string(),
    deleted: v.boolean(),
  })
    .index("by_task", ["taskId"])
    .index("undeleted_by_task", ["taskId", "deleted"]),

  callSessions: defineTable({
    channelId: v.id("channels"),
    cloudflareMeetingId: v.string(),
    active: v.boolean(),
  })
    .index("by_channel_active", ["channelId", "active"]),

  spreadsheetCellRefs: defineTable({
    spreadsheetId: v.id("spreadsheets"),
    cellRef: v.string(),       // "A1" or "A1:C3" (normalized uppercase)
    values: v.string(),        // JSON-serialized string[][] (e.g., [["42"]] or [["a","b"],["c","d"]])
    updatedAt: v.number(),
  })
    .index("by_spreadsheet", ["spreadsheetId"])
    .index("by_spreadsheet_cellRef", ["spreadsheetId", "cellRef"]),

  medias: defineTable({
    storageId: v.id("_storage"),
    workspaceId: v.id("workspaces"),
    uploadedBy: v.id("users"),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    type: v.union(v.literal("image")), // extend later: "video", "file", etc.
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_storage_id", ["storageId"]),

  collaborationTokens: defineTable({
    token: v.string(),
    userId: v.id("users"),
    roomId: v.string(),
    expiresAt: v.number(), // timestamp ms
  })
    .index("by_token", ["token"]),

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
