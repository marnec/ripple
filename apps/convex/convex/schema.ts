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

/**
 * Mirrors `@convex-dev/resend`'s own `Status` union (`vStatus`), spelled out
 * here rather than imported. A validator in this schema is a storage contract:
 * importing the component's would let a version bump that adds a status make
 * every historical row in this table fail validation. Kept deliberately
 * identical — if the component gains a status, this list is where it lands.
 *
 * `waiting` → not yet batched, `queued` → batched and awaiting send, `sent` →
 * handed to Resend with its fate unknown, and the rest are terminal.
 */
export const emailDeliveryStatus = v.union(
  v.literal("waiting"),
  v.literal("queued"),
  v.literal("cancelled"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("delivery_delayed"),
  v.literal("bounced"),
  v.literal("failed"),
);

/**
 * Where an exhausted outbound run reports, for the ops whose failure does not
 * land on the pushed task's `taskIntegrationLinks` row. Set alongside `taskId`
 * for `issueCreate` (the task exists; the link is what failed to be created).
 */
export const outboundRunSink = v.union(
  v.object({
    kind: v.literal("issueCreate"),
    projectIntegrationLinkId: v.id("projectIntegrationLinks"),
  }),
  v.object({
    kind: v.literal("commentCreate"),
    commentId: v.id("taskComments"),
  }),
  v.object({
    kind: v.literal("commentLink"),
    commentLinkId: v.id("taskCommentIntegrationLinks"),
  }),
  v.object({
    kind: v.literal("issueClose"),
    workspaceId: v.id("workspaces"),
    issueNumber: v.number(),
    provider: v.string(),
  }),
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
    // Canonical (lowercase) GitHub login, captured at OAuth sign-in (see
    // auth.ts). Lets inbound GitHub assignees resolve to this user without a
    // per-workspace `workspaceMemberExternalIdentity` row — that table stays
    // the provider-generic override (and the home for non-OAuth providers /
    // manual linking). Absent for users who never signed in via GitHub.
    githubLogin: v.optional(v.string()),
    // Canonical GitLab identity, captured at GitLab OAuth sign-in (see auth.ts).
    // GitLab addresses users by numeric id (not login), so `gitlabUserId` is the
    // match key that lets inbound GitLab assignees resolve to this user without a
    // per-workspace `workspaceMemberExternalIdentity` row; `gitlabLogin` (the
    // lowercase username) is kept for display / manual linking. Both absent for
    // users who never signed in via GitLab. Mirrors the GitHub pair above.
    gitlabUserId: v.optional(v.string()),
    gitlabLogin: v.optional(v.string()),
    // Platform-level admin flag. Distinct from per-workspace WorkspaceRole.ADMIN:
    // this grants access to the separate admin web app (apps/admin), which is
    // backed by this same deployment. Set manually via the Convex dashboard —
    // there is no mutation that flips it, so it can't be self-granted through
    // either frontend. Absent (falsy) for all normal users.
    isPlatformAdmin: v.optional(v.boolean()),
    // Account-disabled flag, toggled from the admin app (admin/users.setDisabled).
    // When true, `auth.ts`'s beforeSessionCreation callback rejects sign-in and
    // existing sessions are invalidated. Reversible (reactivate clears it).
    // Content authored by the user is preserved — mirrors member-removal policy.
    disabled: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_github_login", ["githubLogin"])
    .index("by_gitlab_user_id", ["gitlabUserId"])
    .index("by_gitlab_login", ["gitlabLogin"]),

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
  })
    // "which workspaces does this user own" — the guard that stops
    // `admin/users.deleteAccount` from dangling an `ownerId`. Without it that
    // guard was a full-table scan on every account deletion.
    .index("by_owner", ["ownerId"]),

  workspaceMembers: defineTable({
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    role: v.union(...Object.values(WorkspaceRole).map((role) => v.literal(role))),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  workspaceInvites: defineTable({
    workspaceId: v.id("workspaces"),
    email: v.string(),
    invitedBy: v.id("users"),
    status: v.union(...Object.values(InviteStatus).map((status) => v.literal(status))),
    // ── Email delivery (the `@convex-dev/resend` component) ──────────
    // `status` above is the *invite's* lifecycle (pending/accepted/…); these
    // three are the lifecycle of the mail that announced it, which is a
    // different question and used to have no answer at all: a Resend 429 left
    // the row at `pending`, indistinguishable from "hasn't replied yet".
    // `deliveryEmailId` is the component's own id, so `resend.status()` and the
    // webhook remain the source of truth and these columns are the denormalized
    // read the invite list renders from.
    deliveryEmailId: v.optional(v.string()),
    deliveryStatus: v.optional(emailDeliveryStatus),
    // Set on bounce/failure only. A bounce is the failure class a send-side
    // error column can never see, which is most of why delivery went through
    // the component rather than a hand-rolled pool.
    deliveryError: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_by_email_by_status", ["workspaceId", "email", "status"])
    .index("by_email_and_status", ["email", "status"])
    // Deployment-wide "show me the pending invites", which is the admin
    // console's whole reason to open this table. `by_email_and_status` can't
    // answer it — its prefix is the address — so without this the console
    // paginated the raw table and filtered in the client, meaning the operator
    // had to page through accepted invites to find a stuck one.
    .index("by_status", ["status"])
    // The webhook arrives keyed by the component's email id and nothing else.
    .index("by_delivery_email", ["deliveryEmailId"]),

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
    // Exact-name lookup for `rename`'s duplicate check. The `by_name` search
    // index below cannot answer that question: it is tokenized, so it matches
    // on any shared word and on prefixes. See `documents.rename`.
    .index("by_workspace_name", ["workspaceId", "name"])
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
    pendingDeletion: v.optional(v.boolean()), // true while the join drain runs via workpool
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
    .index("by_project_isDefault", ["projectId", "isDefault"])
    // Triage destination lookup (inbound webhook + activation gate). Exactly
    // one isTriage=true per project, so this resolves to a single row.
    .index("by_project_isTriage", ["projectId", "isTriage"])
    // Lowest-`order` completed status — the default inbound-close destination.
    .index("by_project_isCompleted_order", ["projectId", "isCompleted", "order"])
    // Lowest-`order` completed status for a given close reason — drives
    // `state_reason=not_planned` routing without scanning all completed rows.
    .index("by_project_isCompleted_closeReason_order", [
      "projectId",
      "isCompleted",
      "externalCloseReason",
      "order",
    ]),

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
          // True once the linked external issue is deleted on the provider
          // side (GitHub `issues.deleted` webhook). Denormalized here — off
          // the high-churn `taskIntegrationLinks` row — so kanban/list cards
          // can show a "deleted upstream" indicator without subscribing to
          // the link table. Source of truth is
          // `taskIntegrationLinks.externalDeletedAt`.
          deleted: v.optional(v.boolean()),
        }),
      ),
    ),
    // GitHub assignees that did NOT win Ripple's single `assigneeId` slot —
    // unmatched external logins plus matched-but-not-first members. Denormalized
    // here (off the high-churn `taskIntegrationLinks` row) so the kanban / task
    // list can render them beside the internal assignee without subscribing to
    // the link table. Written in lockstep with `assigneeId` by
    // `applyAssigneesChanged`; changes at the same low frequency as the internal
    // assignee, so it doesn't destabilize the card row. Source of truth is
    // `taskIntegrationLinks.externalAssignees`. Absent when there are none.
    externalAssignees: v.optional(
      v.array(
        v.object({
          login: v.string(),
          avatarUrl: v.string(),
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
        // External author preserved across disconnect so reconnect can
        // restore the real GitHub identity. No inbound event after task
        // creation rewrites `taskIntegrationLinks.externalAuthor`, so without
        // this snapshot a rehydrated link would be stuck on a placeholder.
        // Optional: rows frozen before this field shipped won't carry it.
        externalAuthor: v.optional(
          v.object({
            login: v.string(),
            avatarUrl: v.string(),
            url: v.string(),
          }),
        ),
      }),
    ),
    // Denormalized "most-advanced state" across the task's linked pull
    // requests, maintained by the PR sync reconciler. Lets kanban/list cards
    // show a PR indicator without reading the (webhook-churned)
    // taskPullRequestLinks/pullRequests tables on the hot path. Absent when
    // the task has no linked PRs.
    pullRequestState: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("open"),
        v.literal("merged"),
        v.literal("closed"),
      ),
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
    .index("by_assignee_completed", ["assigneeId", "completed"])
    // `listByAssignee` is workspace-scoped; without the workspace key it read
    // the caller's tasks in every workspace and filtered in JS, which also
    // made a foreign workspace's task write invalidate this subscription.
    .index("by_workspace_assignee_completed", ["workspaceId", "assigneeId", "completed"])
    .index("by_project_status", ["projectId", "statusId"])
    // Read by the `isCompleted` drain: selecting the rows that still disagree
    // with the column makes each batch's own patch move them out of the range,
    // so `.take()` advances without a cursor and the loop is self-terminating.
    .index("by_project_status_completed", ["projectId", "statusId", "completed"])
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_completed", ["workspaceId", "completed"])
    .index("by_project_status_position", ["projectId", "statusId", "position"])
    // Intentionally unqueried today: reserved for `ENG-42` deep links. Kept on
    // purpose, so the next dead-index sweep leaves it alone — the other three
    // never-read indexes were dropped in the same pass.
    .index("by_project_number", ["projectId", "number"])
    .index("by_importJob", ["importJobId"])
    .index("by_yjsSnapshotId", ["yjsSnapshotId"]),

  // Denormalized lookup of `tasks.externalRefs`, kept in sync by the single
  // writer module taskExternalLink.ts — every externalRefs write goes through
  // its verbs, which reconcile the lookup in the same call (NOT a dbTriggers
  // hook — the integration write paths run below the trigger boundary; see
  // taskExternalLink.ts for why). Deletion is cascaded via
  // cascadeDelete.ts. Exists only so the PR-sync reconciler can answer "which
  // task carries issue #N in repo X" with a point
  // index lookup instead of scanning every task in the project on each
  // pull_request webhook — the issue number can't be indexed on `tasks` itself
  // because it lives in a nested array. Same Convex-can't-index-nested-fields
  // rationale as `taskTags`. One row per (task, repo, issueNumber) ref.
  taskExternalRefs: defineTable({
    taskId: v.id("tasks"),
    projectId: v.id("projects"),
    repoFullName: v.string(),
    issueNumber: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_project_repo_issue", [
      "projectId",
      "repoFullName",
      "issueNumber",
    ]),

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
    // Liveness heartbeat: stamped by every unit of work an import does (a
    // GitHub page applied, a CSV row created or failed). A queued/running job
    // that has not moved this in a while is presumed dead and stops holding
    // the project's import lock — see `taskImportStaleness.ts`. Absent on rows
    // predating it, which fall back to `_creationTime` and therefore clear
    // themselves rather than staying wedged.
    lastProgressAt: v.optional(v.number()),
    // What kind of import drives this job. Absent on existing rows (= CSV);
    // integration imports set this explicitly so workspace-settings UIs can
    // distinguish them. The `rows` field stays as `[]` for non-CSV sources.
    sourceType: v.optional(
      v.union(v.literal("csv"), v.literal("github_integration")),
    ),
    projectIntegrationLinkId: v.optional(v.id("projectIntegrationLinks")),
  })
    .index("by_project_status", ["projectId", "status"])
    .index("by_project", ["projectId"])
    // Cross-project, for the stale-job sweep — the only reader that does not
    // already know which project it is asking about.
    .index("by_status", ["status"]),

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
    // Whether this call was started with transcription on. Decided by the first
    // joiner (who creates the Cloudflare meeting with `transcribe_on_end`) and
    // reused by everyone who joins the same call. Drives the meeting's
    // transcribe_on_end flag and the participant preset.
    transcribe: v.optional(v.boolean()),
    // Cloudflare session id, learned from the `meeting.transcript` webhook.
    cloudflareSessionId: v.optional(v.string()),
    // The document seeded from this call's transcript. Set once by the webhook
    // ingest; doubles as the idempotency guard against duplicate deliveries.
    transcriptDocumentId: v.optional(v.id("documents")),
  })
    .index("by_channel_active", ["channelId", "active"])
    .index("by_meeting", ["cloudflareMeetingId"])
    // Lets the documents delete-trigger clear this FK when a transcript doc is
    // removed, keeping `transcriptDocumentId` consistent (no dangling links).
    .index("by_transcript_document", ["transcriptDocumentId"]),

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

  // Denormalized fields:
  //   - `projectId` : for efficient filtering
  //   - `completed` : copied from tasks.completed, kept in sync by the tasks
  //                   trigger in dbTriggers.ts (same one that maintains
  //                   taskTags). Cycle progress is `completed / total` over
  //                   these join rows, read by three subscribed queries; without
  //                   it each one had to `db.get` the full task document per row
  //                   just to read one boolean, which put every task in every
  //                   cycle into the subscription's read set.
  // No `by_cycle_completed` index: progress needs the total too, so all of a
  // cycle's join rows are read either way and the completed count is a filter
  // over rows already in hand. An index would add a second scan and buy nothing.
  cycleTasks: defineTable({
    cycleId: v.id("cycles"),
    taskId: v.id("tasks"),
    projectId: v.id("projects"),
    completed: v.optional(v.boolean()),
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
    // The complete candidate set for any time window: `validateTimes` caps
    // event duration at 24h, so an event touching a window must start within
    // 24h before it. Both calendar range queries scan only this index.
    .index("by_workspace_starts", ["workspaceId", "startsAt"])
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
    // ── Email delivery (the `@convex-dev/resend` component) ──────────
    // The same three columns `workspaceInvites` carries, for the same reason,
    // and they matter more here: `status` above stays `pending` whether the
    // guest is thinking it over or never received the invitation. Guest
    // addresses are hand-typed on a share link, so this is where bad addresses
    // concentrate.
    //
    // Calendar mail is sent with `sendEmailManually` (the component's batch
    // endpoint carries no attachments), which creates one component record per
    // *attempt* — so this holds the newest attempt's id, and a read of delivery
    // state is newest-wins, never `.unique()` over the component's records.
    deliveryEmailId: v.optional(v.string()),
    // Resend's *own* message id, which `workspaceInvites` has no need of.
    // Calendar mail sends manually, and the component only dispatches its
    // `onEmailEvent` callback when its `lastOptions` row exists — a row written
    // exclusively by the batch path. A deployment that has never sent a
    // workspace invite therefore drops every delivery event for manual sends,
    // silently. Keeping Resend's id here lets the webhook route resolve events
    // itself, so tracking does not depend on another sender having run first.
    deliveryResendId: v.optional(v.string()),
    deliveryStatus: v.optional(emailDeliveryStatus),
    deliveryError: v.optional(v.string()),
  })
    .index("by_event", ["eventId"])
    .index("by_event_user", ["eventId", "userId"])
    .index("by_event_guest_email", ["eventId", "guestEmail"])
    .index("by_share", ["shareId"])
    .index("by_delivery_email", ["deliveryEmailId"])
    .index("by_delivery_resend", ["deliveryResendId"]),

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
      // document → channel: this document is the transcript of a call held in
      // the channel. Created in `documents.createForTranscript` alongside the
      // transcript doc; cascades away when either the doc or channel is deleted.
      // Visible link in the workspace graph (like hosted_in, not filtered).
      v.literal("transcript_of"),
    ),
    workspaceId: v.id("workspaces"),
    sourceNodeId: v.optional(v.id("nodes")),
    targetNodeId: v.optional(v.id("nodes")),
    // For `embeds` edges that target a single Excalidraw frame of a diagram:
    // the frame element's id. Undefined = whole-resource embed (the default,
    // and every pre-frame-tracking row). Lets `getFrameEmbeds` warn before a
    // frame embedded elsewhere is deleted, without changing diagram-level
    // backlinks (those still key off targetId).
    frameId: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_target", ["targetId"])
    .index("by_source", ["sourceId"])
    .index("by_source_edgetype", ["sourceId", "edgeType"])
    .index("by_target_edgetype", ["targetId", "edgeType"])
    .index("by_source_target", ["sourceId", "targetId"])
    .index("by_workspace_target", ["workspaceId", "targetId"])
    .index("by_workspace", ["workspaceId"])
    // Lets the workspace graph read only the edge kinds it draws. `by_workspace`
    // scans `belongs_to` too — one row per task, the single largest edge term —
    // and filtering those out in JS does not un-read them.
    .index("by_workspace_edgetype", ["workspaceId", "edgeType"]),

  // Multiplicity for **mention edges** (CONTEXT.md). One row per
  // (channel, target) pair that is currently mentioned at least once.
  //
  // The `edges` row for that pair is written once — on the first mention — and
  // deleted when the last one goes; every mention in between only touches this
  // table. That split is the point: the workspace graph subscribes to the whole
  // `edges.by_workspace` range, and Convex re-runs a query when a write lands in
  // a range it read, so writing an edge row per message re-shipped the entire
  // graph to every client on the page on every chatty message. Nothing that
  // reads the graph reads this table, so repeat mentions are now invisible to it.
  //
  // Before this table, a doc mentioned in 4,000 messages had 4,000 identical
  // edge rows: the backlinks panel read all 4,000 to render one chip, and a
  // message edit collected the whole bucket to delete a single row.
  channelMentionCounts: defineTable({
    workspaceId: v.id("workspaces"),
    channelId: v.id("channels"),
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
    // The single `edges` row this counter keeps alive. Holding the id makes the
    // decrement path a point delete instead of a scan of the duplicate bucket,
    // and lets the collapse migration be re-run safely (a row whose `edgeId` is
    // the edge being visited is already accounted for).
    edgeId: v.id("edges"),
    // Live messages in `channelId` mentioning `targetId`. Invariant: >= 1 while
    // this row exists — the row and its edge are created and dropped together.
    count: v.number(),
    // Newest mention. Kept so the edge can later be weighted or windowed by
    // recency; a raw all-time count would leave last year's busiest channel as
    // the heaviest edge in the graph forever.
    lastAt: v.number(),
  })
    .index("by_channel_target", ["channelId", "targetId"])
    .index("by_target", ["targetId"])
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
    // Set at node creation and maintained by the tasks node trigger if the
    // task ever changes project. Was documented as "immutable, set once" —
    // which was true only because no write path moves a task between projects,
    // not because anything enforced it. `getEnrichedBacklinks` (edges.ts) reads
    // it, so a future "move task" feature would otherwise silently report the
    // old project.
    metadata: v.optional(
      v.union(
        v.object({ type: v.literal("task"), projectId: v.id("projects") }),
      ),
    ),
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
    .index("by_resource_id", ["resourceId"])
    // For workspace cascade-delete: workspace-scoped rows have no owning
    // resource so they aren't reached via a resource cascade.
    .index("by_workspace", ["workspaceId"]),

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
    // Opaque outbound credential the gateway resolves via `credentialRef`
    // (seam 2). GitHub leaves this unset — it mints a short-lived token from the
    // App installation id (`externalAccountId`). GitLab uses this for the
    // current access token: either a long-lived PAT (advanced) OR an OAuth
    // access token. Treat as a secret (candidate for at-rest encryption);
    // never returned to clients.
    credentialToken: v.optional(v.string()),
    // OAuth refresh bundle. Present iff `credentialToken` was minted via OAuth
    // (vs pasted as a PAT). The token-resolution seam refreshes when
    // `oauthExpiresAt` is within 60s; both fields rotate together. A PAT install
    // leaves these unset and the seam returns `credentialToken` verbatim.
    oauthRefreshToken: v.optional(v.string()),
    oauthExpiresAt: v.optional(v.number()),
    // Provider-side login of this install's bot identity — the author string a
    // delivery carries when it's the echo of one of our own outbound ops.
    // GitHub: `<app-slug>[bot]`; GitLab: the token owner's username. The
    // inbound echo guard compares an event's author against this instead of a
    // provider-specific slug pattern. Optional + backfilled: rows written
    // before this column (and unconfigured deployments) leave the guard inert.
    externalBotLogin: v.optional(v.string()),
    // Workspace admin who completed the install. Surfaced in the
    // workspace-settings installations list ("installed by …"). Optional
    // for rows created before this column existed.
    installedBy: v.optional(v.id("users")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_externalAccount", ["externalAccountId"]),

  // Short-lived CSRF/state rows for the GitHub App install redirect. The
  // `beginAppInstall` mutation persists a nonce + the initiating
  // workspace/user; the `/integrations/github/setup` callback consumes it
  // (one-time) to resolve which workspace the new installation belongs to.
  integrationInstallStates: defineTable({
    nonce: v.string(),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    provider: v.string(),
    expiresAt: v.number(),
    // PKCE code verifier for OAuth flows (GitLab). The OAuth callback exchanges
    // the auth code together with this verifier; the hash was sent as the
    // `code_challenge` in the authorize URL. Unused for the GitHub App flow,
    // which doesn't use PKCE (the App installation is the auth).
    codeVerifier: v.optional(v.string()),
    // Where to send the browser after the round trip, so the install picker can
    // open on whichever page the flow started from. App-relative; validated at
    // write time in `beginAppAuthorize`.
    returnTo: v.optional(v.string()),
  })
    .index("by_nonce", ["nonce"])
    // For workspace cascade-delete (these are short-lived but tidy up anyway).
    .index("by_workspace", ["workspaceId"]),

  // External accounts a user proved they can reach, captured mid-flow so they
  // can pick which one to connect. Provider-agnostic like every other table
  // here: `provider` says which flow produced the list, and the candidate shape
  // reuses `workspaceIntegrations`' neutral vocabulary (externalAccountId /
  // accountLogin / accountType) rather than any provider's own nouns.
  //
  // Why it exists, in GitHub's case: `installations/new` only shows an install
  // screen when the App is NOT already on the account — otherwise GitHub
  // redirects to that installation's settings page and never comes back, which
  // left a workspace unable to (re)claim an installation it could plainly see.
  // The way back in is the user-authorization flow: authorize, read
  // `GET /user/installations`, let the user choose. Any provider whose
  // authorization can resolve to more than one connectable account lands here
  // the same way.
  //
  // The rows ARE the possession proof — written only from a user-to-server
  // token — so the claim can trust membership of this list without calling the
  // provider again. Short-lived and one-time: deleted on claim.
  integrationInstallCandidates: defineTable({
    token: v.string(),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    provider: v.string(),
    candidates: v.array(
      v.object({
        externalAccountId: v.string(),
        accountLogin: v.optional(v.string()),
        accountType: v.optional(
          v.union(v.literal("organization"), v.literal("user")),
        ),
      }),
    ),
    // Carried from the flow that built the list so the claim stays
    // provider-agnostic — GitHub derives it from the App slug, GitLab from the
    // authorizing user, and neither belongs in the shared claim path.
    externalBotLogin: v.optional(v.string()),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_workspace", ["workspaceId"]),

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
    // Provider-side numeric user id (stored as string, matching the codebase's
    // convention for provider numeric ids — cf. externalAccountId). GitLab
    // addresses assignees/authors by id, not login, so its adapter resolves
    // members through this; GitHub keeps using `externalLogin`. Optional +
    // backfilled — rows written before this column simply don't match by id.
    externalUserId: v.optional(v.string()),
  })
    .index("by_workspace_provider_login", ["workspaceId", "provider", "externalLogin"])
    .index("by_workspace_user_provider", ["workspaceId", "userId", "provider"])
    .index("by_workspace_provider_userId", ["workspaceId", "provider", "externalUserId"]),

  // Per repo↔project binding. The `status` state machine is orthogonal to
  // the `pausedByBilling` entitlement flag — both feed `effectiveLinkStatus`.
  // Provider-agnostic field names so a future GitLab adapter slots in
  // without a schema migration.
  projectIntegrationLinks: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.id("projects"),
    // The specific workspace integration (account + provider) this link was
    // created through. A workspace may hold several integrations (e.g. a GitHub
    // org + personal install, or GitHub + GitLab), so the bot user / provider /
    // account for a link's webhooks and outbound auth must be resolved from
    // THIS row — not workspace-wide (which isn't unique). Optional only for
    // rows created before this column shipped; backfilled by
    // migrations.backfillLinkWorkspaceIntegration. A project has at most one
    // active link (enforced in createLink).
    workspaceIntegrationId: v.optional(v.id("workspaceIntegrations")),
    status: v.union(
      v.literal("configuring"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("disconnected"),
    ),
    pausedByBilling: v.boolean(),
    // Set on the entitlement-revoke flip; cleared on entitlement-restore.
    // Drives the >24 h "Force resync" banner.
    frozenAt: v.optional(v.number()),
    // Timestamp of the most recent webhook delivery processed for this link.
    // Drives the "Last webhook received" indicator in workspace settings.
    lastWebhookAt: v.optional(v.number()),
    // Human-readable "owner/repo" — feeds tasks.externalRefs[].repoFullName
    // and the URL for issue links. Updated silently on repo rename events;
    // stable lookups use externalRepoId.
    externalRepoFullName: v.string(),
    // Stable provider-side repo identifier. GitHub: repository node id.
    // GitLab: the numeric project id (also the outbound `projectRef`).
    // Survives renames; the webhook adapter resolves the link by this
    // before falling back to anything else.
    externalRepoId: v.string(),
    // Per-hook secret for inbound webhook verification. GitLab webhooks aren't
    // centralized (no org-wide App secret), so each project's hook carries its
    // own `X-Gitlab-Token`, verified against this per-link value. GitHub leaves
    // it unset — it verifies the central `X-Hub-Signature-256` HMAC instead.
    webhookSecret: v.optional(v.string()),
    // Optional branch→status automation: when a PR merges into `branch`, the
    // linked task(s) advance to `statusId` (forward-only, most-advanced-wins).
    // Branch ≈ deploy environment. `branch` is a glob pattern (`*` wildcard,
    // e.g. `release/*`); a literal name is an exact match. On a merge the
    // most-specific matching rule wins. Empty/absent = no branch automation
    // (completion falls back to the issues.closed path).
    branchStatusMap: v.optional(
      v.array(
        v.object({
          branch: v.string(),
          statusId: v.id("taskStatuses"),
        }),
      ),
    ),
    // Default base branch for the task "Create branch" action. Absent = the
    // repo's default branch (resolved live from GitHub at creation time). Set
    // this to `develop` for Git Flow so feature branches cut from the right base.
    defaultBaseBranch: v.optional(v.string()),
    // Whether the task "Create branch" button prompts for the source branch
    // each time (opening the base-branch picker). Absent = true (prompt). Flips
    // to false via the picker's admin-only "Don't ask again" or project settings.
    askBranchSourceEachTime: v.optional(v.boolean()),
    // When true, inbound issue + issue-comment webhooks (GitHub → Ripple) are
    // dropped for this link — the project stops auto-pulling issue changes.
    // Absent/false = sync (the default). Orthogonal to `status: "paused"` (which
    // halts BOTH directions) and to PR sync / outbound push / explicit import,
    // all of which keep working. Gated in `handleGithubWebhook`.
    inboundIssueSyncDisabled: v.optional(v.boolean()),
    // Tag→repo routing: when creating an issue from a task whose labels match
    // exactly one repo's tag set, that repo is preselected in the create-issue
    // dialog. A tag belongs to at most one repo within a project (enforced in
    // setRepoTagRules). Normalized (trim+lowercase) to match tasks.labels.
    // Absent/empty = no routing rule for this repo.
    autoSelectTags: v.optional(v.array(v.string())),
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
    // ms timestamp of the provider-side issue deletion (GitHub `issues.deleted`
    // webhook). Orthogonal to `externalState` (an open OR closed issue can be
    // deleted) — kept as a distinct field so the outbound echo guard, which
    // reads `externalState`, is untouched. Once set, outbound pushes are
    // skipped (the issue is gone; a PATCH would 404) and the task detail
    // surfaces an "issue deleted on GitHub" badge. The Ripple task itself is
    // preserved — deletion only orphans the link.
    externalDeletedAt: v.optional(v.number()),
    // The git branch Ripple created for this issue (`<issueNumber>-<slug>`),
    // set by the "Create branch" action. Drives the task-detail branch chip +
    // the prefilled "Create pull request" compare link. Absent until a branch
    // is created from Ripple (a PR opened by hand still links via the
    // issue-number-in-branch convention without this being set).
    branchName: v.optional(v.string()),
    // The base branch `branchName` was cut from. Drives the "Create pull
    // request" compare URL so the PR targets the right base (e.g. `develop`
    // for a Git Flow feature) rather than always the repo default. Absent for
    // legacy branches created before this was recorded (falls back to default).
    branchBaseRef: v.optional(v.string()),
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
    // True once a genuine USER edit has touched the Yjs description in Ripple.
    // The GitHub creation-time seed must NEVER set this — it gates the manual
    // "Sync description to GitHub" button so seed-only content is not treated
    // as a pushable change. Persistent, so reopening an edited task still shows
    // the button.
    descriptionEdited: v.optional(v.boolean()),
    // Lifecycle of the GitHub creation-time description seed. Drives the
    // client's open-time gate reactively so the editor no longer relies on an
    // arbitrary timeout: "pending" while the seed action is in flight, then a
    // terminal "seeded" / "skipped" / "failed". Absent = legacy link or a task
    // that never scheduled a seed (empty issue body) — the client backstop
    // timer covers those. See seedDescriptionAction + use-description-seed-gate.
    seedStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("seeded"),
        v.literal("skipped"),
        v.literal("failed"),
      ),
    ),
  })
    // Idempotency / "have we imported this issue?" lookup.
    .index("by_link_externalIssueId", [
      "projectIntegrationLinkId",
      "externalIssueId",
    ])
    .index("by_task", ["taskId"]),

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
    // bot-user avatar on external-authored (inbound) comments. ABSENT for
    // Ripple-originated comments pushed out to GitHub: those keep their real
    // author's avatar, so stamping our own App bot here would override it.
    externalAuthor: v.optional(
      v.object({
        login: v.string(),
        avatarUrl: v.string(),
        url: v.string(),
      }),
    ),
    lastSyncError: v.optional(
      v.object({
        occurredAt: v.number(),
        message: v.string(),
        httpStatus: v.optional(v.number()),
      }),
    ),
  })
    .index("by_taskComment", ["taskCommentId"])
    // Scoped by the task link, NOT by `externalCommentId` alone. Comment ids
    // are only unique within a provider's own namespace, and both providers
    // hand us plain numbers — GitHub's numeric REST comment id and a GitLab
    // note id live in the same string space here, so a bare lookup can resolve
    // an edit/delete echo onto another repo's row. The link is in scope at all
    // four call sites, so scoping costs nothing. The prefix also serves the
    // cascade rule in `cascadeDelete.ts`, which eq's only the first field.
    .index("by_taskIntegrationLink_externalCommentId", [
      "taskIntegrationLinkId",
      "externalCommentId",
    ]),

  // One row per external pull/merge request (canonical state). Many-to-many
  // with tasks via `taskPullRequestLinks` — a PR can close several issues and
  // a task can have several PRs. Provider-agnostic field names so a GitLab
  // merge-request adapter slots in without a migration. Inbound, read-only:
  // Ripple never writes PR state back to the host.
  pullRequests: defineTable({
    workspaceId: v.id("workspaces"),
    projectIntegrationLinkId: v.id("projectIntegrationLinks"),
    provider: v.string(),
    // Stable provider-side PR id (GitHub: PR node id). Survives renames.
    externalPrId: v.string(),
    // Human-facing PR number under the repo (e.g. 7 for #7).
    number: v.number(),
    title: v.string(),
    url: v.string(),
    // draft|open are produced on open; merged|closed land in Phase 2.
    state: v.union(
      v.literal("draft"),
      v.literal("open"),
      v.literal("merged"),
      v.literal("closed"),
    ),
    // Source branch (head) and target branch (base). baseRef drives the
    // Phase 4 branch→status mapping.
    headRef: v.string(),
    baseRef: v.string(),
    externalAuthor: v.object({
      login: v.string(),
      avatarUrl: v.string(),
      url: v.string(),
    }),
    // Provider event mtime, ms since epoch. Drives the ordering guard.
    externalUpdatedAt: v.number(),
    // Set on merge (Phase 2).
    mergedAt: v.optional(v.number()),
  })
    .index("by_link_externalPrId", ["projectIntegrationLinkId", "externalPrId"])
    .index("by_workspace", ["workspaceId"]),

  // Join between a pull request and the task(s) it closes. Resolved from the
  // host's native closing references ("Closes #N"). Many-to-many.
  taskPullRequestLinks: defineTable({
    taskId: v.id("tasks"),
    pullRequestId: v.id("pullRequests"),
  })
    .index("by_task", ["taskId"])
    .index("by_pullRequest", ["pullRequestId"]),

  // Maps an in-flight `@convex-dev/action-retrier` runId → whatever an
  // exhausted run has to mark. The retrier's `onComplete` callback receives
  // only `{ runId, result }`, so this side table is how the callback resolves
  // its target. One row per in-flight run, inserted at dispatch and deleted on
  // completion — so concurrent pushes on the same task no longer clobber a
  // single link field.
  //
  // `sink` names where the failure lands, because it is not the task's link row
  // for every op: a comment push marks the comment (or its link row), and the
  // two ops with no link row to mark at all — issue-create, issue-close — reach
  // only the workspace audit log. Absent means the original task-keyed case,
  // which is both the common one and the shape of every row written before the
  // other ops gained tracking, so a run in flight across a deploy still lands.
  integrationOutboundRuns: defineTable({
    runId: v.string(),
    taskId: v.optional(v.id("tasks")),
    sink: v.optional(outboundRunSink),
  }).index("by_runId", ["runId"]),

  // Background work that exhausted its retries and gave up.
  //
  // One table rather than a column per drain: these jobs have no single row to
  // hang a status off — a channel fanout spans every member of a workspace, a
  // tag strip spans every tagged resource — and the surface the theme actually
  // asks for is one list of "work that stopped", not a failure flag scattered
  // across five tables nobody thinks to query together.
  //
  // `kind` is the drain (`module:function`), `key` the thing it was draining
  // (a channel id, a tag id). Together they say what to re-run.
  backgroundJobFailures: defineTable({
    kind: v.string(),
    key: v.string(),
    error: v.string(),
    failedAt: v.number(),
  })
    .index("by_kind", ["kind"])
    .index("by_kind_key", ["kind", "key"]),

  // How far a periodic job has already read through an append-only source.
  //
  // The problem it exists for: a cron that sweeps a window someone else owns
  // sees the same rows on every run. The webhook receiver's dead-letter queue
  // holds an entry for 30 days, so a daily mirror would re-report the same
  // dead delivery thirty times — and would undo `admin.jobs.dismiss`, since a
  // dismissed row would simply reappear tomorrow.
  //
  // Deliberately *not* a column on any of those sources: they are component
  // tables this app cannot alter, and the point of the shape is that the next
  // such job adds a `job` string and nothing else — no new table, no new
  // index, no edit to `jobWatermarks.ts`. `cursor` is whatever monotonic
  // ordinal that source exposes (a `movedAt`, a `_creationTime`, a sequence
  // number); the job that writes it is the only thing that has to know which.
  jobWatermarks: defineTable({
    job: v.string(),
    cursor: v.number(),
  }).index("by_job", ["job"]),
});
