import { authTables } from "@convex-dev/auth/server";
import { InviteStatus } from "@shared/enums/inviteStatus";
import { ChannelRole, WorkspaceRole } from "@shared/enums/roles";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
  })
  .index("by_workspace", ["workspaceId"])
  .index("by_isPublicInWorkspace", ["isPublic", "workspaceId"])
  .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),


  channelMembers: defineTable({
    channelId: v.id("channels"),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: channelRoleSchema,
    lastReadAt: v.optional(v.number()),
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
    key: v.optional(v.string()), // 2-5 char uppercase identifier (e.g., "ENG")
    taskCounter: v.optional(v.number()), // auto-increment counter for task numbers
    tags: v.optional(v.array(v.string())),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_key", ["workspaceId", "key"])
    .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),

  taskStatuses: defineTable({
    projectId: v.id("projects"),
    name: v.string(), // "To Do", "In Progress", "Done"
    color: v.string(), // Tailwind class like "bg-gray-500"
    order: v.number(), // display order (0, 1, 2...)
    isDefault: v.boolean(), // marks the default status for new tasks (only one per project)
    isCompleted: v.boolean(), // when true, tasks with this status are considered completed
    setsStartDate: v.optional(v.boolean()), // when true, auto-sets startDate on tasks entering this status
  })
    .index("by_project", ["projectId"])
    .index("by_project_order", ["projectId", "order"])
    .index("by_project_isDefault", ["projectId", "isDefault"]),

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
    number: v.optional(v.number()), // sequential task number within project (e.g., 42 for ENG-42)
    dueDate: v.optional(v.string()), // ISO date string "2026-03-15"
    startDate: v.optional(v.string()), // ISO date string
    estimate: v.optional(v.number()), // effort estimate in hours
  })
    .index("by_project", ["projectId"])
    .index("by_project_completed", ["projectId", "completed"])
    .index("by_assignee", ["assigneeId"])
    .index("by_assignee_completed", ["assigneeId", "completed"])
    .index("by_project_status", ["projectId", "statusId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_project_status_position", ["projectId", "statusId", "position"])
    .index("by_project_number", ["projectId", "number"]),

  taskComments: defineTable({
    taskId: v.id("tasks"),
    userId: v.id("users"),
    body: v.string(),
    deleted: v.boolean(),
  })
    .index("by_task", ["taskId"])
    .index("undeleted_by_task", ["taskId", "deleted"]),

  taskDependencies: defineTable({
    taskId: v.id("tasks"), // source task
    dependsOnTaskId: v.id("tasks"), // target task
    type: v.union(v.literal("blocks"), v.literal("relates_to")),
    creatorId: v.id("users"),
  })
    .index("by_task", ["taskId"])
    .index("by_depends_on", ["dependsOnTaskId"])
    .index("by_pair", ["taskId", "dependsOnTaskId"]),

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

  favorites: defineTable({
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    resourceType: v.union(
      v.literal("document"),
      v.literal("diagram"),
      v.literal("spreadsheet"),
      v.literal("project"),
    ),
    resourceId: v.string(), // polymorphic ID stored as string
    favoritedAt: v.number(),
  })
    .index("by_workspace_user", ["workspaceId", "userId"])
    .index("by_workspace_user_type", ["workspaceId", "userId", "resourceType"])
    .index("by_user_resource", ["userId", "resourceId"]),

  contentReferences: defineTable({
    sourceType: v.union(v.literal("document"), v.literal("task")),
    sourceId: v.string(),
    targetType: v.union(v.literal("diagram"), v.literal("spreadsheet"), v.literal("document")),
    targetId: v.string(),
    workspaceId: v.id("workspaces"),
  })
    .index("by_target", ["targetId"])
    .index("by_source", ["sourceId"]),

  documentBlockRefs: defineTable({
    documentId: v.id("documents"),
    blockId: v.string(),
    blockType: v.string(),
    textContent: v.string(),
    updatedAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_document_blockId", ["documentId", "blockId"]),

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

  cycles: defineTable({
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
    startDate: v.optional(v.string()), // ISO date "2026-03-01"
    dueDate: v.optional(v.string()),   // ISO date "2026-03-31"
    status: v.union(
      v.literal("draft"),
      v.literal("upcoming"),
      v.literal("active"),
      v.literal("completed"),
    ),
    creatorId: v.id("users"),
  })
    .index("by_project", ["projectId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_project_status", ["projectId", "status"]),

  cycleTasks: defineTable({
    cycleId: v.id("cycles"),
    taskId: v.id("tasks"),
    projectId: v.id("projects"), // denormalized for efficient filtering
    addedBy: v.id("users"),
  })
    .index("by_cycle", ["cycleId"])
    .index("by_task", ["taskId"])
    .index("by_cycle_task", ["cycleId", "taskId"]),

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

  channelNotificationPreferences: defineTable({
    userId: v.id("users"),
    channelId: v.id("channels"),
    chatMention: v.boolean(),
    chatChannelMessage: v.boolean(),
  })
    .index("by_user_channel", ["userId", "channelId"])
    .index("by_channel", ["channelId"]),

  projectNotificationPreferences: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
    taskAssigned: v.boolean(),
    taskDescriptionMention: v.boolean(),
    taskCommentMention: v.boolean(),
    taskComment: v.boolean(),
    taskStatusChange: v.boolean(),
  })
    .index("by_user_project", ["userId", "projectId"])
    .index("by_project", ["projectId"]),

  notificationPreferences: defineTable({
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
  })
    .index("by_user", ["userId"]),

  recentActivity: defineTable({
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    resourceType: v.union(
      v.literal("channel"),
      v.literal("document"),
      v.literal("diagram"),
      v.literal("spreadsheet"),
      v.literal("project"),
    ),
    resourceId: v.string(),
    resourceName: v.string(),
    visitedAt: v.number(),
  })
    .index("by_user_workspace", ["userId", "workspaceId"])
    .index("by_user_workspace_visited", ["userId", "workspaceId", "visitedAt"])
    .index("by_user_resource", ["userId", "resourceId"]),
});
