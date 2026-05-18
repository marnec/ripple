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

  // Extend the auth-provided users table with `isBot` so integration-created
  // synthetic users (e.g. the GitHub bot) can be distinguished from human
  // workspace members. The spread above includes the default users table;
  // this explicit override replaces it with the augmented shape.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    isBot: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

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
    email: v.optional(v.string()), // denormalized from users.email — used for DM dedup when a user row is replaced
    name: v.optional(v.string()),  // denormalized from users displayName — avoids N+1 when rendering member lists; synced via the users trigger
    // DEPRECATED: moved to userChannelState. Kept as v.optional so deploys
    // accept production rows that still carry it. Drop after
    // migrateChannelLastReadAtToUserChannelState (in runAll) has run on prod.
    lastReadAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_channel", ["channelId"])
    .index("by_channel_user", ["channelId", "userId"])
    .index("by_workspace_user", ["workspaceId", "userId"])
    .index("by_channel_role", ["channelId", "role"]),

  // Per-(user, channel) auxiliary state. Split from `channelMembers` because
  // `lastReadAt` mutates on every channel visit and `channelMembers` is read
  // by `membersByChannel` for every member of the channel — co-locating
  // user-private hot writes with a widely-subscribed doc would invalidate
  // every member's subscription on every visit by anyone. This table is only
  // ever read for the calling user (`by_channel_user` / `by_workspace_user`),
  // so writes here only invalidate the writer's own subscriptions.
  userChannelState: defineTable({
    userId: v.id("users"),
    channelId: v.id("channels"),
    workspaceId: v.id("workspaces"),
    lastReadAt: v.optional(v.number()),
    // Sidebar hide timestamp. Semantics depend on channel type — handled by
    // the sidebar query, not by this field:
    //   - DM: "hidden until a message newer than this arrives." Auto-unhide
    //     on next message, no write needed.
    //   - Open: "hidden until explicitly unhidden." Any value = stay hidden.
    //   - Closed: ignored (closed channels are left, not hidden).
    hiddenAt: v.optional(v.number()),
  })
    .index("by_channel_user", ["channelId", "userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

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
      v.literal("calendarEvent"),
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
    pendingDeletion: v.optional(v.boolean()), // true while bulk task reassignment drains via workpool
    // Marks the destination for externally-ingested issues (GitHub etc.).
    // Mutually exclusive with isDefault. Activating an integration requires
    // exactly one isTriage=true status per project; the integration
    // mutation layer is the only writer that may place a task here.
    isTriage: v.optional(v.boolean()),
    // Provider-specific close-reason hint. When set on a completed status,
    // inbound `state=closed, state_reason=not_planned` routes here.
    // Defaults to "completed" semantics if unset.
    externalCloseReason: v.optional(
      v.union(v.literal("completed"), v.literal("not_planned")),
    ),
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
    importJobId: v.optional(v.id("taskImportJobs")), // set when the task was created via CSV import
    // Static, immutable-per-link external references. Written exactly twice
    // (link create, link destroy) plus on repo rename. Read by kanban /
    // task-list — high-churn integration state lives on taskIntegrationLinks
    // to keep this row stable.
    externalRefs: v.optional(
      v.array(
        v.object({
          provider: v.string(),
          repoFullName: v.string(),
          issueNumber: v.number(),
          url: v.string(),
        }),
      ),
    ),
    // Frozen denormalized snapshot written by the disconnect cascade BEFORE
    // hard-deleting the per-task `taskIntegrationLinks` row. Preserves
    // historical context (provider, repo, issue number/id, URL, when the
    // disconnect happened) so links to commits, PRs, and external
    // conversations survive an unlink. Also the rehydration key on
    // reconnect: the same repo re-linked to the same project matches
    // existing tasks via `externalRefFrozen.externalIssueId`.
    externalRefFrozen: v.optional(
      v.object({
        provider: v.string(),
        // Stable provider-side repo identifier. Survives renames; the
        // reconnect path uses this (not repoFullName) to rehydrate links.
        externalRepoId: v.string(),
        repoFullName: v.string(),
        issueNumber: v.number(),
        externalIssueId: v.string(),
        url: v.string(),
        disconnectedAt: v.number(),
      }),
    ),
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
    .index("by_importJob", ["importJobId"])
    .index("by_yjsSnapshotId", ["yjsSnapshotId"]),

  // CSV-driven bulk-task import jobs. One per project at a time (enforced in
  // taskImports.createImportJob). Rows are stored opaquely (v.any()) — the
  // strict shape lives in @shared/taskImportSchema and is enforced on both
  // client and server before tasks are written.
  taskImportJobs: defineTable({
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
    creatorId: v.id("users"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    rows: v.array(v.any()),
    // Pre-reserved contiguous task-number range. project.taskCounter is
    // advanced by totalRows once at job creation; the workpool action then
    // assigns numberRangeStart + index per row without touching the counter.
    numberRangeStart: v.number(),
    totalRows: v.number(),
    processedRows: v.number(),
    failedRows: v.number(),
    errorMessage: v.optional(v.string()), // top-level failure (e.g. all rows rejected)
    completedAt: v.optional(v.number()),
    // What kind of import drives this job. Absent on existing rows (= CSV);
    // integration imports set this explicitly so workspace-settings UIs can
    // distinguish them. The `rows` field stays as `[]` for non-CSV sources.
    sourceType: v.optional(
      v.union(v.literal("csv"), v.literal("github_integration")),
    ),
    projectIntegrationLinkId: v.optional(v.id("projectIntegrationLinks")),
  })
    .index("by_project_status", ["projectId", "status"])
    .index("by_project", ["projectId"]),

  taskComments: defineTable({
    taskId: v.id("tasks"),
    userId: v.id("users"),
    body: v.string(),
    deleted: v.boolean(),
    // Permanent outbound failure marker for the *create* dispatch — there's
    // no `taskCommentIntegrationLinks` row yet at create-failure time, so the
    // error lives on the comment row itself. Update/delete failures land on
    // the link row's `lastSyncError`.
    lastSyncError: v.optional(
      v.object({
        occurredAt: v.number(),
        message: v.string(),
        httpStatus: v.optional(v.number()),
      }),
    ),
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

  // Workspace-level scheduled meetings ("planned calls"). Visible only to the
  // creator and explicit invitees (see calendarEventInvitees) — channel
  // membership is NEVER consulted for event access (see requireEventViewer in
  // calendarEvents.ts). channelId is purely a meeting venue: when set, the
  // call reuses that channel's persistent RealtimeKit room via callSessions;
  // otherwise cloudflareMeetingId is lazy-created on the event itself on first
  // join. DM channels are excluded from the picker UI side — a DM has no
  // agenda of its own and reusing its room would surface the meeting to
  // whichever two members the DM happens to belong to.
  calendarEvents: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    description: v.optional(v.string()),
    startsAt: v.number(),  // ms UTC timestamp
    endsAt: v.number(),    // ms UTC timestamp
    timezone: v.string(),  // IANA, e.g. "Europe/Rome" — organizer's tz at creation
    channelId: v.optional(v.id("channels")),
    cloudflareMeetingId: v.optional(v.string()), // lazy on first join (standalone events)
    createdBy: v.id("users"),
    // iCalendar SEQUENCE — bumped each time we email guests about a
    // change (reschedule, cancel). Mail clients use this to dedupe and
    // to apply ICS updates in order. Treat undefined as 0 for legacy rows.
    sequence: v.optional(v.number()),
    // Denormalized tag list, mirrors documents/diagrams. Authoritative tag
    // membership lives in `entityTags` (with `resourceType: "calendarEvent"`).
    // Sync via `syncTagsForResource` in tagSync.ts; the calendarEvents
    // dbTrigger forwards changes to the polymorphic `nodes` row.
    tags: v.optional(v.array(v.string())),
  })
    .index("by_workspace_starts", ["workspaceId", "startsAt"])
    .index("by_creator", ["createdBy"])
    .index("by_channel", ["channelId"])
    // For @event mention autocomplete: title search filtered to the active
    // workspace. Empty queries still use by_workspace_starts (browse mode).
    .searchIndex("by_title", {
      searchField: "title",
      filterFields: ["workspaceId"],
    }),

  // Per-recipient invite + RSVP state for calendar events. Exactly one of
  // userId / guestEmail is set. For guest rows, shareId references a
  // resourceShares row (resourceType="calendarEvent", accessLevel="join"); the
  // magic-link URL emailed to the guest is the existing `${SITE_URL}/share/${shareId}`.
  calendarEventInvitees: defineTable({
    eventId: v.id("calendarEvents"),
    workspaceId: v.id("workspaces"), // denormalized for "my events" cross-event scans
    userId: v.optional(v.id("users")),
    guestEmail: v.optional(v.string()),
    guestName: v.optional(v.string()),  // captured at first RSVP/join
    guestSub: v.optional(v.string()),   // mirrors shares.ts guest-sub pattern
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("tentative"),
    ),
    respondedAt: v.optional(v.number()),
    shareId: v.optional(v.string()),    // FK to resourceShares.shareId (guest rows only)
    // Idempotency for inbound ICS RSVP replies (packages/rsvp-worker). The
    // mail client echoes the original UID and a fresh DTSTAMP/SEQUENCE on
    // every Yes/Maybe/No click. Drop replies whose (sequence, dtstamp) is
    // not strictly newer than what we've already applied.
    lastRsvpDtstamp: v.optional(v.number()),
    lastRsvpSequence: v.optional(v.number()),
  })
    .index("by_event", ["eventId"])
    .index("by_event_user", ["eventId", "userId"])
    .index("by_event_guest_email", ["eventId", "guestEmail"])
    .index("by_user_workspace_event", ["userId", "workspaceId", "eventId"])
    .index("by_share", ["shareId"]),

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
    // Event categories: per-channel object shape `{ push, email }`. The
    // legacy plain-boolean shape is preserved in the union so existing
    // rows keep validating; `prefersChannel` reads either form. New
    // writes from settings always use the object form. See
    // packages/shared/src/notificationCategories.ts:CATEGORY_CHANNELS.
    eventInvited: v.optional(
      v.union(v.boolean(), v.object({ push: v.boolean(), email: v.boolean() })),
    ),
    eventUpdated: v.optional(
      v.union(v.boolean(), v.object({ push: v.boolean(), email: v.boolean() })),
    ),
    eventCancelled: v.optional(
      v.union(v.boolean(), v.object({ push: v.boolean(), email: v.boolean() })),
    ),
    eventResponseChanged: v.optional(v.boolean()),
  })
    .index("by_user", ["userId"]),

  edges: defineTable({
    sourceType: v.union(
      v.literal("document"),
      v.literal("task"),
      v.literal("diagram"),
      v.literal("spreadsheet"),
      v.literal("channel"),
      v.literal("calendarEvent"),
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
      v.literal("calendarEvent"),
    ),
    targetId: v.string(),
    edgeType: v.union(
      v.literal("embeds"),
      v.literal("blocks"),
      v.literal("relates_to"),
      v.literal("mentions"),
      v.literal("belongs_to"),
      // calendarEvent → channel: the channel hosts this event's meeting room.
      // Visible link in the workspace graph (not filtered like belongs_to).
      v.literal("hosted_in"),
      // calendarEvent → user: the user is an invitee on this event. Created
      // via a trigger on `calendarEventInvitees` insert; cleaned up via the
      // same trigger's delete branch (single-row removal) or via cascade
      // when the event itself is deleted. Organisers do NOT get this edge
      // automatically — only via the explicit self-invite shortcut, which
      // is the same physical write path. Edge presence tracks row presence
      // regardless of RSVP status; declined invitees stay edged.
      v.literal("invites"),
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
      v.literal("calendarEvent"),
    ),
    resourceId: v.string(), // typed Convex ID cast to string (polymorphic)
    name: v.string(),       // tasks map title→name
    tags: v.array(v.string()), // tasks map labels→tags; channels always []
    metadata: v.optional(
      v.union(
        v.object({ type: v.literal("task"), projectId: v.id("projects") }),
      ),
    ), // immutable, set once at node creation
    // Whether this node should appear in `nodes.search` (Ctrl+K). Defaults
    // to `true` when undefined, so existing rows are unchanged. Calendar
    // events explicitly set `false`: they participate in the graph and
    // edges but are discovered via the calendar UI or via backlinks from
    // connected nodes — fuzzy search would surface low-information past
    // events as noise.
    searchable: v.optional(v.boolean()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_type", ["workspaceId", "resourceType"])
    .index("by_resource", ["resourceId"])
    .index("by_resource_workspace", ["resourceId", "workspaceId"])
    .searchIndex("by_name", {
      searchField: "name",
      filterFields: ["workspaceId", "resourceType", "searchable"],
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
      v.literal("calendarEvent"),
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
    // Admin-only audit label ("Acme Corp review", "Q3 vendor", …). Never
    // exposed to guests via getShareInfo — purely for owner-side tracking.
    name: v.optional(v.string()),
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

  // Per-workspace feature capability rows. Single chokepoint for "is this
  // workspace allowed to use feature X?" via `hasFeature`. v1 sources rows
  // manually from admin toggles; future billing flips the same rows with a
  // non-manual `source`, leaving the UI affordance unchanged.
  workspaceEntitlements: defineTable({
    workspaceId: v.id("workspaces"),
    featureKey: v.string(),
    enabled: v.boolean(),
    // Where the entitlement came from. v1 ships only "manual" via the
    // admin toggle; future billing flows would write "tier" or "plugin"
    // through the same code path so the UI affordance stays stable.
    source: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("tier"),
        v.literal("plugin"),
      ),
    ),
  })
    .index("by_workspace_feature", ["workspaceId", "featureKey"]),

  // Per-workspace integration install. Carries the synthetic bot user used
  // for attributing externally-authored tasks and comments. One row per
  // (workspace, externalAccountId) — a workspace can install on multiple
  // accounts (e.g. org + personal), each producing its own bot user.
  workspaceIntegrations: defineTable({
    workspaceId: v.id("workspaces"),
    botUserId: v.id("users"),
    // Provider identifier. Open string for v1 ("github"); a future GitLab
    // adapter sets "gitlab". Kept here rather than on each
    // projectIntegrationLinks row because installation is per-provider.
    provider: v.string(),
    // Provider-side account/install id. GitHub: App installation id.
    // Lookup key when the webhook adapter resolves a delivery's
    // workspace by `payload.installation.id`.
    externalAccountId: v.string(),
    // Display metadata captured at install time so workspace-settings can
    // render "Installed on @acme (Organization)" without a REST call.
    externalAccountType: v.optional(
      v.union(v.literal("organization"), v.literal("user")),
    ),
    accountLogin: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_externalAccount", ["externalAccountId"]),

  // Per-(workspace, member) mapping of internal users to provider-side
  // identities. Looked up by the inbound integration code to match a GitHub
  // assignee login to a workspace member; the bot-user fallback covers
  // unmatched logins. Provider-agnostic so a future GitLab adapter slots in
  // without a schema migration — just a different `provider` value.
  workspaceMemberExternalIdentity: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    provider: v.string(), // "github", "gitlab", ...
    externalLogin: v.string(), // canonical (lowercase) provider username
  })
    .index("by_workspace_provider_login", ["workspaceId", "provider", "externalLogin"])
    .index("by_workspace_user_provider", ["workspaceId", "userId", "provider"]),

  // Per repo↔project binding. The `status` state machine is orthogonal to
  // the `pausedByBilling` entitlement flag — both feed `effectiveLinkStatus`.
  // Provider-agnostic field names so a future GitLab adapter slots in
  // without a schema migration.
  projectIntegrationLinks: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.id("projects"),
    status: v.union(
      v.literal("configuring"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("disconnected"),
    ),
    pausedByBilling: v.boolean(),
    // Human-readable "owner/repo" — feeds tasks.externalRefs[].repoFullName
    // and the URL for issue links. Updated silently on repo rename events;
    // stable lookups use externalRepoId.
    externalRepoFullName: v.string(),
    // Stable provider-side repo identifier. GitHub: repository node id.
    // Survives renames; the webhook adapter resolves the link by this
    // before falling back to anything else.
    externalRepoId: v.string(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_project", ["projectId"])
    .index("by_externalRepo", ["externalRepoId"]),

  // Per-task hot/dynamic integration state. Read only by task-detail and
  // webhook handlers — kanban/task-list reads stay on `tasks.externalRefs`.
  // High-churn fields (externalUpdatedAt, descriptionSyncState, lastSyncError,
  // etc.) live here so kanban subscriptions don't invalidate on webhook traffic.
  taskIntegrationLinks: defineTable({
    taskId: v.id("tasks"),
    projectIntegrationLinkId: v.id("projectIntegrationLinks"),
    externalIssueId: v.string(),
    externalUpdatedAt: v.number(),
    externalAuthor: v.object({
      login: v.string(),
      avatarUrl: v.string(),
      url: v.string(),
    }),
    // Markdown body captured at issue creation. Phase 6 converts this into
    // BlockNote/Yjs as a creation-time seed. Absent for Ripple-native tasks
    // that get a taskIntegrationLinks row via outbound link creation.
    initialBodyMarkdown: v.optional(v.string()),
    // Last-known external state. Written by inbound, read by outbound's
    // echo guard to skip PATCHes that would produce no GitHub-side change.
    externalState: v.optional(v.union(v.literal("open"), v.literal("closed"))),
    externalStateReason: v.optional(
      v.union(v.literal("completed"), v.literal("not_planned")),
    ),
    // Permanent-failure marker. Set when outbound dispatch hits a 4xx
    // (non-429) response; surfaces the "⚠ Sync failed — Retry" affordance
    // on the affected task. Cleared on next successful outbound.
    lastSyncError: v.optional(
      v.object({
        occurredAt: v.number(),
        message: v.string(),
        httpStatus: v.optional(v.number()),
      }),
    ),
    // RunId for the in-flight action-retrier dispatch, so the retrier's
    // onComplete callback (which receives only `runId` + `result`) can map
    // back to this link to record retry-exhaustion failures. Cleared on
    // completion (success or failure).
    outboundRunId: v.optional(v.string()),
    // Mirror of the last-known GitHub label set (normalized: lowercased,
    // deduped). Drives the inbound echo guard (if nextLabels matches, the
    // event is a re-delivery of our own outbound push) and the outbound diff
    // (what to POST/DELETE on the GitHub side).
    externalLabels: v.optional(v.array(v.string())),
    // Mirror of the last-known GitHub assignee logins (full set, preserving
    // GitHub's order). Drives the inbound echo guard (same set → bounce-back
    // from our own outbound push) and the outbound diff (which logins to
    // POST as adds / DELETE as removes on the GitHub side).
    externalAssigneeLogins: v.optional(v.array(v.string())),
    // Display payload for assignees that did NOT win the `assigneeId` slot
    // (either unmatched logins or matched-but-not-first). The task detail
    // renders these as shadow chips alongside the primary assignee so the
    // multi-assignee story from GitHub isn't lost in Ripple's single-assignee
    // model. Always set together with `externalAssigneeLogins`.
    externalAssignees: v.optional(
      v.array(
        v.object({
          login: v.string(),
          avatarUrl: v.string(),
          url: v.string(),
        }),
      ),
    ),
    // GitHub user who closed the issue (when the close came from outside
    // Ripple). Renders as "Closed on GitHub by @\<login\>" on task detail.
    // Cleared on reopen so the badge doesn't outlive its truth.
    externalClosedBy: v.optional(
      v.object({
        login: v.string(),
        avatarUrl: v.string(),
        url: v.string(),
      }),
    ),
    // ms timestamp of the last successful Ripple→GitHub description push
    // via the manual "Sync description to GitHub" button. Purely
    // informational — Ripple is the source of truth for description
    // content, so there is no reconciliation; this exists to render
    // "Last synced X ago" alongside the sync button.
    descriptionLastSyncedAt: v.optional(v.number()),
  })
    // Idempotency / "have we imported this issue?" lookup.
    .index("by_link_externalIssueId", [
      "projectIntegrationLinkId",
      "externalIssueId",
    ])
    .index("by_task", ["taskId"])
    .index("by_outboundRunId", ["outboundRunId"]),

  // Per-comment integration state. Mirrors the task-level link split: the hot
  // `taskComments` row stays free of webhook-driven churn; this row carries
  // the GitHub comment id, the echo-guard mirror, the external author blob,
  // and the in-flight outbound bookkeeping.
  taskCommentIntegrationLinks: defineTable({
    taskCommentId: v.id("taskComments"),
    taskIntegrationLinkId: v.id("taskIntegrationLinks"),
    // Stable provider-side comment id. GitHub returns this as a number; we
    // stringify in the adapter so the schema stays provider-agnostic.
    externalCommentId: v.string(),
    // Last-known external mtime. Drives the inbound stale-event drop and
    // the outbound echo guard (skip when our pending push matches what
    // GitHub already shows).
    externalUpdatedAt: v.number(),
    // GitHub identity for display — rendered as the small chip next to the
    // bot-user avatar on external-authored comments.
    externalAuthor: v.object({
      login: v.string(),
      avatarUrl: v.string(),
      url: v.string(),
    }),
    outboundRunId: v.optional(v.string()),
    lastSyncError: v.optional(
      v.object({
        occurredAt: v.number(),
        message: v.string(),
        httpStatus: v.optional(v.number()),
      }),
    ),
  })
    .index("by_taskComment", ["taskCommentId"])
    .index("by_taskIntegrationLink", ["taskIntegrationLinkId"])
    .index("by_externalCommentId", ["externalCommentId"])
    .index("by_outboundRunId", ["outboundRunId"]),
});
