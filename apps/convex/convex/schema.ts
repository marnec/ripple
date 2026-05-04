import { authTables } from "@convex-dev/auth/server";
import { InviteStatus } from "@ripple/shared/enums/inviteStatus";
import { ChannelRole, ChannelType, WorkspaceRole } from "@ripple/shared/enums/roles";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const channelRoleSchema = v.union(
  ...Object.values(ChannelRole).map((role) => v.literal(role)),
);

export const channelTypeSchema = v.union(
  ...Object.values(ChannelType).map((type) => v.literal(type)),
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
    type: channelTypeSchema,
  })
  .index("by_workspace", ["workspaceId"])
  .index("by_type_workspace", ["type", "workspaceId"])
  .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId", "type"] }),


  channelMembers: defineTable({
    channelId: v.id("channels"),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: channelRoleSchema,
    lastReadAt: v.optional(v.number()),
    email: v.optional(v.string()), // denormalized from users.email — used for DM dedup when a user row is replaced
    name: v.optional(v.string()),  // denormalized from users displayName — avoids N+1 when rendering member lists; synced via the users trigger
  })
    .index("by_user", ["userId"])
    .index("by_channel", ["channelId"])
    .index("by_channel_user", ["channelId", "userId"])
    .index("by_workspace_user", ["workspaceId", "userId"])
    .index("by_channel_role", ["channelId", "role"]),

  channelJoinRequests: defineTable({
    workspaceId: v.id("workspaces"),
    channelId: v.id("channels"),
    userId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied"),
    ),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
  })
    .index("by_channel_status", ["channelId", "status"])
    .index("by_channel_user_status", ["channelId", "userId", "status"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_user_status", ["userId", "status"]),

  documents: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    tags: v.optional(v.array(v.string())),
    yjsSnapshotId: v.optional(v.id("_storage")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_yjsSnapshotId", ["yjsSnapshotId"])
    .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),

  diagrams: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    tags: v.optional(v.array(v.string())),
    yjsSnapshotId: v.optional(v.id("_storage")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_yjsSnapshotId", ["yjsSnapshotId"])
    .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),

  spreadsheets: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    tags: v.optional(v.array(v.string())),
    yjsSnapshotId: v.optional(v.id("_storage")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_yjsSnapshotId", ["yjsSnapshotId"])
    .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),

  projects: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    color: v.string(), // Tailwind color class like "bg-blue-500"
    workspaceId: v.id("workspaces"),
    creatorId: v.id("users"), // the user who created the project (the admin)
    key: v.optional(v.string()), // 2-5 char uppercase identifier (e.g., "ENG")
    taskCounter: v.optional(v.number()), // auto-increment counter for task numbers
    tags: v.optional(v.array(v.string())), // TEMP: remove after running cleanupProjectTagsField migration
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_key", ["workspaceId", "key"])
    .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),

  // Centralized workspace tag dictionary. Source of truth for autocomplete,
  // future rename/metadata. The denormalized `tags`/`labels` arrays on each
  // resource remain as a projection for fast combined-filter search inside
  // each resource's `.search` query.
  // No usageCount column — entity counts (if ever needed) come from an
  // @convex-dev/aggregate over entityTags so a high-write tag can't hot-spot.
  tags: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(), // canonical: trim().toLowerCase()
  })
    .index("by_workspace_name", ["workspaceId", "name"])
    .index("by_workspace", ["workspaceId"])
    .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),

  // Project-scoped task→tag join. Tasks live one level deeper than the four
  // workspace-scoped resources (documents/diagrams/spreadsheets/projects),
  // so they get a dedicated table whose indexes match that scope. Both the
  // dictionary `tags` table and the polymorphic `entityTags` table are
  // unaffected.
  // Denormalized fields:
  //   - `tagName`   : copied from tags.name for cheap reads (matches entityTags)
  //   - `completed` : copied from tasks.completed so the primary access path
  //                   ("completed tasks in project P tagged X") is a single
  //                   indexed range scan. Kept in sync by a tasks.completed
  //                   trigger in dbTriggers.ts.
  taskTags: defineTable({
    workspaceId: v.id("workspaces"),
    projectId:   v.id("projects"),
    taskId:      v.id("tasks"),
    tagId:       v.id("tags"),
    tagName:     v.string(),
    completed:   v.boolean(),
    // Denormalized sort/filter fields. Optional because the source `tasks`
    // columns are optional. Kept in sync by the tasks-table trigger in
    // dbTriggers.ts. Names match the source columns on `tasks` so the trigger
    // is mechanical. `assigneeId` powers the workspace-wide tag+assignee join
    // used by `listByAssignee`.
    dueDate:           v.optional(v.string()),
    plannedStartDate:  v.optional(v.string()),
    assigneeId:        v.optional(v.id("users")),
  })
    .index("by_project_tag_completed",                   ["projectId", "tagId", "completed"])
    .index("by_project_tag_completed_dueDate",           ["projectId", "tagId", "completed", "dueDate"])
    .index("by_project_tag_completed_plannedStartDate",  ["projectId", "tagId", "completed", "plannedStartDate"])
    .index("by_workspace_tag",                           ["workspaceId", "tagId"])
    .index("by_workspace_tag_completed",                 ["workspaceId", "tagId", "completed"])
    .index("by_workspace_assignee_tag_completed",        ["workspaceId", "assigneeId", "tagId", "completed"])
    .index("by_task",                                    ["taskId"]),

  // Polymorphic join: which tags apply to which resources. `resourceId` is
  // a typed Convex ID cast to string (mirrors the `nodes` table convention).
  entityTags: defineTable({
    workspaceId: v.id("workspaces"),
    tagId: v.id("tags"),
    tagName: v.string(), // denormalized from tags.name for cheap reads
    resourceType: v.union(
      v.literal("document"),
      v.literal("diagram"),
      v.literal("spreadsheet"),
      v.literal("project"),
    ),
    resourceId: v.string(),
  })
    .index("by_workspace_tag", ["workspaceId", "tagId"])
    .index("by_resource_id", ["resourceId"]) // cascade-delete + per-resource lookup
    .index("by_workspace_tag_type", ["workspaceId", "tagId", "resourceType"]),

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
    startDate: v.optional(v.string()), // deprecated — migration strips this field
    plannedStartDate: v.optional(v.string()), // ISO date string, set by PM via calendar
    workPeriods: v.optional(v.array(v.object({
      startedAt: v.number(), // ms timestamp, auto-set by setsStartDate status transition
      completedAt: v.optional(v.number()), // ms timestamp, auto-set by isCompleted status transition
    }))),
    estimate: v.optional(v.number()), // effort estimate in hours
  })
    .index("by_project", ["projectId"])
    .index("by_project_completed", ["projectId", "completed"])
    .index("by_project_completed_dueDate", ["projectId", "completed", "dueDate"])
    .index("by_project_completed_plannedStartDate", ["projectId", "completed", "plannedStartDate"])
    .index("by_project_completed_assignee", ["projectId", "completed", "assigneeId"])
    .index("by_project_completed_assignee_dueDate", ["projectId", "completed", "assigneeId", "dueDate"])
    .index("by_project_completed_assignee_plannedStartDate", ["projectId", "completed", "assigneeId", "plannedStartDate"])
    .index("by_project_completed_priority", ["projectId", "completed", "priority"])
    .index("by_project_completed_priority_dueDate", ["projectId", "completed", "priority", "dueDate"])
    .index("by_project_completed_priority_plannedStartDate", ["projectId", "completed", "priority", "plannedStartDate"])
    .index("by_assignee", ["assigneeId"])
    .index("by_assignee_completed", ["assigneeId", "completed"])
    .index("by_project_status", ["projectId", "statusId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_completed", ["workspaceId", "completed"])
    .index("by_project_status_position", ["projectId", "statusId", "position"])
    .index("by_project_number", ["projectId", "number"])
    .index("by_yjsSnapshotId", ["yjsSnapshotId"]),

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
    cellRef: v.string(),       // Live A1 — updated in place on every server push.
    stableRef: v.string(),     // JSON-encoded StableRef tracking the logical cell.
    orphan: v.optional(v.boolean()),   // True when stableRef can no longer resolve.
    values: v.string(),        // JSON-serialized string[][] (e.g., [["42"]] or [["a","b"],["c","d"]]).
    updatedAt: v.number(),
  })
    .index("by_spreadsheet", ["spreadsheetId"])
    .index("by_spreadsheet_stableRef", ["spreadsheetId", "stableRef"]),

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
    .index("by_user_resource", ["userId", "resourceId"])
    .index("by_resource_id", ["resourceId"]),


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
    channelJoinRequest: v.optional(v.boolean()),
    channelJoinDecision: v.optional(v.boolean()),
  })
    .index("by_user", ["userId"]),

  edges: defineTable({
    sourceType: v.union(
      v.literal("document"),
      v.literal("task"),
      v.literal("diagram"),
      v.literal("spreadsheet"),
      v.literal("channel"),
    ),
    sourceId: v.string(),
    targetType: v.union(
      v.literal("document"),
      v.literal("task"),
      v.literal("diagram"),
      v.literal("spreadsheet"),
      v.literal("user"),
      v.literal("project"),
      v.literal("channel"),
    ),
    targetId: v.string(),
    edgeType: v.union(
      v.literal("embeds"),
      v.literal("blocks"),
      v.literal("relates_to"),
      v.literal("mentions"),
      v.literal("belongs_to"),
    ),
    workspaceId: v.id("workspaces"),
    sourceNodeId: v.optional(v.id("nodes")),
    targetNodeId: v.optional(v.id("nodes")),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_target", ["targetId"])
    .index("by_source", ["sourceId"])
    .index("by_source_edgetype", ["sourceId", "edgeType"])
    .index("by_target_edgetype", ["targetId", "edgeType"])
    .index("by_source_target", ["sourceId", "targetId"])
    .index("by_workspace_target", ["workspaceId", "targetId"])
    .index("by_workspace", ["workspaceId"]),

  nodes: defineTable({
    workspaceId: v.id("workspaces"),
    resourceType: v.union(
      v.literal("document"),
      v.literal("diagram"),
      v.literal("spreadsheet"),
      v.literal("project"),
      v.literal("channel"),
      v.literal("task"),
      v.literal("user"),
    ),
    resourceId: v.string(), // typed Convex ID cast to string (polymorphic)
    name: v.string(),       // tasks map title→name
    tags: v.array(v.string()), // tasks map labels→tags; channels always []
    metadata: v.optional(
      v.union(
        v.object({ type: v.literal("task"), projectId: v.id("projects") }),
      ),
    ), // immutable, set once at node creation
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_type", ["workspaceId", "resourceType"])
    .index("by_resource", ["resourceId"])
    .index("by_resource_workspace", ["resourceId", "workspaceId"])
    .searchIndex("by_name", {
      searchField: "name",
      filterFields: ["workspaceId", "resourceType"],
    }),

  notificationSubscriptions: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    category: v.string(),    // NotificationCategory
    scope: v.string(),       // workspaceId (workspace-level) or channelId/projectId (resource-scoped)
  })
    .index("by_scope_category", ["scope", "category"])       // delivery query
    .index("by_user_workspace", ["userId", "workspaceId"])   // cleanup on member leave
    .index("by_user_scope", ["userId", "scope"])             // preference updates
    .index("by_user_scope_category", ["userId", "scope", "category"]), // upsert check

  appVersion: defineTable({
    deployedAt: v.number(),
  }),

  resourceShares: defineTable({
    shareId: v.string(), // URL-safe random token, ~22 chars
    resourceType: v.union(
      v.literal("document"),
      v.literal("diagram"),
      v.literal("spreadsheet"),
      v.literal("channel"),
    ),
    resourceId: v.string(),
    workspaceId: v.id("workspaces"),
    accessLevel: v.union(
      v.literal("view"),
      v.literal("edit"),
      v.literal("join"),
    ),
    createdBy: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_shareId", ["shareId"])
    .index("by_resource", ["resourceType", "resourceId"])
    .index("by_resource_id", ["resourceId"]),

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
    .index("by_user_resource", ["userId", "resourceId"])
    .index("by_resource_id", ["resourceId"]),
});
