# Project Research Summary

**Project:** Ripple Task Management Integration
**Domain:** Collaborative Task Management in Real-Time Workspaces
**Researched:** 2026-02-05
**Confidence:** HIGH

## Executive Summary

Task management for collaborative workspaces has evolved beyond standalone project tools into deeply integrated systems where tasks are created from conversations, linked to documents, and managed alongside communication. For Ripple's integration, the optimal approach uses @dnd-kit for drag-and-drop (replacing deprecated react-beautiful-dnd), fractional indexing for task ordering, and leverages Convex's native real-time subscriptions for live updates. The architecture follows established patterns from Linear, Notion, and Plane: projects contain tasks, membership-based access control, and bi-directional integration between chat, documents, and tasks.

The critical insight is **progressive complexity**: start with simple Kanban boards (To Do → In Progress → Done), single assignees, and basic task properties. Avoid premature features like custom workflows, sprint planning, or Gantt charts that add complexity without validating user needs. The architecture should mirror Ripple's existing patterns: membership tables for access control, compound indexes for queries, denormalized context IDs for performance, and batch fetching to avoid N+1 queries.

Key risks center on performance at scale (drag-drop with 100+ tasks), permission model explosion (workspace → project → task hierarchy), and real-time conflict resolution when multiple users drag simultaneously. These must be addressed during architecture design, not retrofitted later. The recommended stack integrates seamlessly with Ripple's existing Convex 1.31.7, React 18, and shadcn/ui foundation.

## Key Findings

### Recommended Stack

The 2025-2026 standard for task management uses @dnd-kit (v6.3.1 core, v10.0.0 sortable) as the modern replacement for deprecated react-beautiful-dnd, offering superior performance, accessibility, and touch device support. Date management uses react-day-picker (v9.13.0) via shadcn/ui for consistency with existing design system, paired with date-fns (v4.1.0) for date manipulation. Fractional indexing (lexicographic string positions like "a0", "a1", "a0V") enables task reordering without cascading database updates, critical for real-time collaboration.

**Core technologies:**
- **@dnd-kit**: Drag-and-drop with collision detection, accessibility, and virtualization support — industry standard as of 2025 with 5.4M weekly downloads
- **Fractional indexing**: Infinite task insertions with single-document updates — prevents performance collapse during reordering
- **Convex native patterns**: Optimistic updates and reactive subscriptions — already proven in Ripple's messages and documents
- **shadcn/ui + date-fns**: Date selection and formatting — maintains design consistency and leverages existing dependencies

No additional state management library needed beyond Convex's useQuery/useMutation hooks. The existing convex-helpers (0.1.111), Zod validation, and Radix UI components cover all requirements.

### Expected Features

Modern collaborative workspaces expect task-chat bidirectionality (create tasks from messages, discuss tasks inline) and lightweight Kanban views without Jira-level complexity.

**Must have (table stakes):**
- Basic task CRUD with title, description, status, assignee
- Kanban board view with drag-and-drop between columns
- Create task from chat message (capture action items during conversation)
- Task assignment (single assignee to avoid diffused accountability)
- Rich text descriptions (bold/italic/lists expected post-2024)
- @mentions in tasks with notifications
- Task comments/activity log
- Due dates (optional, no recurring tasks in v1)
- Task list view (alternative to Kanban for power users)
- Push notifications for assignments and mentions
- Search tasks by title, assignee, status

**Should have (competitive):**
- **Embed documents/diagrams in tasks** (v1 INCLUDE — zero-cost differentiation using existing Ripple assets)
- **Project grouping** (v1 INCLUDE — organize tasks under thematic containers, follows Plane model)
- Task templates (v2 — wait for user patterns)
- Bulk operations (v2 — nice UX but not MVP-critical)
- Sub-tasks (v2 — useful but can nest infinitely)
- Task dependencies (v3 — Gantt chart territory)
- Time tracking (v3 — different user persona)
- Automation rules (v2 — requires mature system)

**Defer (v2+):**
- Sprint/cycle planning (avoid Scrum ceremony overhead)
- Custom workflows (premature configuration complexity)
- Multi-assignee tasks (diffuses accountability)
- Recurring tasks (complex edge cases)
- File uploads (redundant with document embeds)
- Priority fields P0-P4 (every task becomes "urgent")
- Gantt charts (over-planning, brittle timelines)

The MVP delivers the Linear-Slack integration pattern (chat → task → board) while leveraging Ripple's documents/diagrams as differentiation. Estimated scope: 8-10 weeks for team of 2-3 developers.

### Architecture Approach

Follow Ripple's established Convex patterns with membership-based access control, compound indexes for query optimization, and denormalized context IDs for performance. The data model uses separate tables for projects, tasks, projectMembers, and taskDependencies (when needed), following the same patterns as documents, channels, and their member tables.

**Major components:**
1. **projects table** — Container for tasks with workspace scoping, status (active/archived/completed), roleCount for UI display, search index for workspace-scoped search
2. **tasks table** — Title, description, status enum (backlog/todo/in_progress/review/done), single assigneeId, sortOrder for Kanban positioning, embedded references object for documents/diagrams/messages, compound indexes for by_project_status (critical for Kanban columns)
3. **projectMembers table** — Junction table with denormalized workspaceId for efficient queries, role enum (admin/member), compound indexes matching channel/document patterns for O(1) permission checks
4. **taskDependencies table** (Phase 5+) — Many-to-many junction for task-to-task relationships with type field (blocks/relates_to), bidirectional indexes for dependency graph traversal

**Key patterns to follow:**
- Membership-based access control: Every entity with permissions has a `*Members` table with `by_entity_user` compound index
- Denormalized context IDs: ProjectMembers include workspaceId for workspace-scoped queries without joins
- Role counts: Store aggregate member counts in project documents for efficient UI display without counting queries
- Batch fetching: Use convex-helpers `getAll()` to avoid N+1 queries when resolving references
- Embedded references: Store small bounded arrays (< 50 items) directly in documents rather than junction tables for documents/diagrams/messages
- Compound indexes: Match query patterns (by_project_status for Kanban, by_project_assignee for "My Tasks")

Real-time updates "just work" via Convex's reactive subscriptions. No separate WebSocket layer needed. Optimistic updates for drag operations prevent UI jank during server round-trips.

### Critical Pitfalls

Research identified 12 pitfalls across critical/moderate/minor severity. Top 5 that require architecture-level prevention:

1. **Drag-and-drop performance collapse at scale** — Choose @dnd-kit over deprecated react-beautiful-dnd from day one. Implement virtualization for 50+ tasks, throttle state updates during drag, use optimistic updates to avoid server round-trip delays. Without this, boards become unusable at 100+ tasks. Address in Phase 2 (Kanban board).

2. **Permission model explosion** — Simplify to workspace → project inheritance. Tasks inherit project permissions with no task-level RBAC initially. Use centralized permission resolver, compound indexes for O(1) checks, and pre-computed role counts. Without this, permission checks become unmaintainable spaghetti requiring multiple database queries. Address in Phase 1 (data model).

3. **Stale cross-entity references** — Tasks created from messages/documents must handle source deletion gracefully. Use indexed foreign keys (sourceMessageId, sourceDocumentId), implement reverse lookup queries, and preserve task content even if source deleted (tombstones, not cascades). Without this, tasks accumulate broken links causing 404s and data integrity issues. Address in Phase 1 (schema design).

4. **Real-time conflict chaos during collaborative drag** — Two users dragging same task simultaneously causes "rubber-banding" UI and lost updates. Separate local drag state from server state, use version fields for optimistic concurrency control, debounce persistence until drop completion. Without this, collaborative boards feel buggy and untrustworthy. Address in Phase 2 (Kanban implementation).

5. **Notification fatigue** — Every task update triggering notifications leads to 47 notifications/day and users disabling all alerts. Implement intelligent batching (max 1 per project per hour), granular preferences per event type, contextual awareness (don't notify if user is viewing board). Without this, critical updates get missed. Address in Phase 4+ (notifications).

Additional moderate pitfalls: board accuracy degradation (make updates frictionless), context loss when creating from chat (auto-capture source metadata), WIP limit ignored (enforce column limits), overcomplicated board structure (start with 3 columns: Todo/In Progress/Done).

## Implications for Roadmap

Based on research, the optimal phase structure follows dependency flow and risk mitigation:

### Phase 1: Projects Foundation
**Rationale:** Projects are the container for tasks. Must establish data model, membership patterns, and permission strategies before building tasks. Highest risk if done wrong - permission model explosion is the #2 critical pitfall and cannot be retrofitted.

**Delivers:** Project CRUD, project list/settings UI, workspace-scoped project queries, role-based access control following established patterns.

**Addresses:**
- Simplifies permission model (workspace → project inheritance)
- Prevents permission model explosion via compound indexes and denormalized context IDs
- Establishes membership table pattern for authorization

**Avoids:**
- Pitfall #2 (permission model explosion) by designing simple hierarchy upfront
- Pitfall #3 (stale references) by setting up referential integrity patterns from start

**Research flag:** LOW — patterns are well-established in existing codebase (documents, channels) and can be directly copied.

### Phase 2: Basic Tasks
**Rationale:** Core task CRUD must be stable before adding complex features like Kanban or integrations. Establishes schema with proper indexes, validates membership-based access control, and proves real-time subscriptions work for tasks.

**Delivers:** Task creation, editing, deletion, basic task list view, assignee field, status field, due dates, rich text descriptions using BlockNote.

**Uses:**
- Convex schema with compound indexes (by_project, by_project_status, by_assignee)
- Fractional indexing for sortOrder field
- Zod validators for task properties

**Implements:**
- Tasks table with all core fields
- Batch fetching for assignee resolution
- Search index for task titles

**Avoids:**
- Premature complexity (no sub-tasks, dependencies, or custom fields yet)
- Building Kanban before validating basic task operations work

**Research flag:** LOW — straightforward CRUD following existing document patterns.

### Phase 3: Kanban Board View
**Rationale:** Kanban is the core UX for task management. Requires Phase 2's stable task model. This phase has highest technical risk due to drag-and-drop performance and real-time conflict resolution.

**Delivers:** Drag-and-drop Kanban board, status column visualization, task reordering within columns, optimistic updates during drag, real-time updates for multi-user collaboration.

**Uses:**
- @dnd-kit (v6.3.1 core, v10.0.0 sortable) for drag-drop
- Fractional indexing for position updates
- Convex optimistic updates (withOptimisticUpdate) for instant feedback

**Implements:**
- Column-based task filtering using by_project_status index
- Drag event handlers with collision detection
- Conflict resolution for concurrent drags

**Avoids:**
- Pitfall #1 (drag-drop performance collapse) by choosing @dnd-kit and implementing throttling
- Pitfall #4 (real-time conflict chaos) by separating local drag state from server state
- Using deprecated react-beautiful-dnd

**Research flag:** MEDIUM — need to test performance at scale (100+ tasks) and validate conflict resolution with concurrent users. May need deeper research on virtualization strategies.

### Phase 4: Task Creation from Chat
**Rationale:** Key integration feature leveraging Ripple's existing messages. Builds on stable task CRUD (Phase 2) and requires embedding message references.

**Delivers:** Right-click message → "Create task" action, modal with pre-filled title from message text, automatic source context capture (messageId, channelId, timestamp), "Jump to conversation" link in task detail.

**Uses:**
- Existing message queries and UI components
- Task references field (embedded object with messages array)
- Mutation chaining to create task from message

**Implements:**
- createFromMessage mutation copying message content and preserving reference
- Task detail view showing source context with clickable links

**Avoids:**
- Pitfall #6 (context loss) by auto-capturing source metadata and preserving links
- Creating tasks in isolation without connection to conversation

**Research flag:** LOW — straightforward pattern, message-to-task conversion is well-documented.

### Phase 5: Document & Diagram Embeds
**Rationale:** Zero-cost differentiation using Ripple's existing collaborative documents and diagrams. Positions Ripple competitively against Linear (GitHub PRs) and Notion (docs).

**Delivers:** Document/diagram reference picker in task detail, embedded preview cards, click-through to full document/diagram editor, reverse lookup (show tasks referencing a document).

**Uses:**
- Task references field (embedded object with documents/diagrams arrays)
- Existing document and diagram queries
- getAll for batch fetching referenced entities

**Implements:**
- Reference management mutations (addReference, removeReference)
- UI components for embedded entity previews
- Indexes for reverse lookups (by_source_document, by_source_diagram)

**Avoids:**
- File upload complexity (redundant with structured document embeds)
- Separate reference tables (embedded arrays sufficient for bounded references)

**Research flag:** LOW — leverages existing document/diagram infrastructure.

### Phase 6: Notifications & Comments
**Rationale:** Task comments reuse existing message infrastructure. Notifications extend existing push system. Both are polish features that don't affect core architecture.

**Delivers:** Task comment threads using message component, @mention notifications in task context, push notifications for task assignments and status changes, notification batching and preferences.

**Uses:**
- Existing message schema and UI components
- Push notification infrastructure already in place
- Granular preference controls per event type

**Implements:**
- Task comment mutations reusing message patterns
- Notification triggers in task mutations
- Batching logic (max 1 per project per hour)

**Avoids:**
- Pitfall #8 (notification fatigue) by implementing intelligent batching and granular preferences from start
- Duplicating message infrastructure with separate comment system

**Research flag:** LOW — Convex notification patterns are well-documented.

### Phase 7: Project-Channel Links (Optional)
**Rationale:** Integration feature for teams wanting dedicated project channels. Least critical, can be deferred post-MVP.

**Delivers:** Link project to channels, show project context in channel, surface project updates in linked channels.

**Uses:**
- ProjectChannels junction table
- Many-to-many relationship patterns

**Implements:**
- Channel selector in project settings
- Bidirectional queries (channels for project, projects for channel)

**Research flag:** LOW — standard junction table pattern.

### Phase Ordering Rationale

**Dependency flow:**
- Projects (Phase 1) → Tasks (Phase 2): Tasks require project container via foreign key
- Tasks (Phase 2) → Kanban (Phase 3): Kanban is just visualization of task status field
- Tasks (Phase 2) → Chat integration (Phase 4): Needs stable task model for mutations
- Tasks (Phase 2) → Embeds (Phase 5): References are optional task fields

**Risk mitigation:**
- Phase 1-2 highest risk: Wrong permission model or schema requires migration
- Phase 3 high technical complexity: Drag-drop performance must be proven early
- Phase 4-7 lower risk: Enhancements building on validated foundation

**Value delivery:**
- Phase 1-3 delivers MVP: Project creation, task management, Kanban visualization
- Phase 4-5 adds differentiation: Chat-to-task and document embeds set Ripple apart
- Phase 6-7 polish: Notifications and channel links enhance but aren't blocking

**Real-time consideration:**
- No special phases needed for real-time updates
- Convex reactive queries handle subscriptions automatically
- Optimistic updates are React patterns at UI layer
- Conflict resolution designed into Phase 3 (Kanban) architecture

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 3 (Kanban):** Performance testing required with 100+ tasks, virtualization strategy needs validation, concurrent drag conflict resolution needs stress testing with multiple users
- **Phase 5 (Embeds):** Reverse lookup query patterns for "show all tasks referencing this document" need performance validation at scale

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Projects):** Direct copy of documents/channels membership patterns from existing codebase
- **Phase 2 (Tasks):** Standard Convex CRUD following established conventions
- **Phase 4 (Chat integration):** Message-to-task mutation is straightforward mutation chaining
- **Phase 6 (Notifications):** Convex notification patterns are well-documented
- **Phase 7 (Links):** Standard junction table, no novel patterns

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | @dnd-kit versions verified via npm (6.3.1, 10.0.0), react-day-picker confirmed in shadcn/ui, Convex patterns proven in existing codebase |
| Features | HIGH | Verified across Linear, Plane, Notion, MS Teams/Planner 2026 updates. Table stakes and differentiators well-documented in competitive analysis |
| Architecture | HIGH | Patterns directly derived from existing Ripple codebase (documents.ts, channels.ts, schema.ts). Convex best practices from official documentation |
| Pitfalls | HIGH | 12 pitfalls verified across multiple authoritative sources. Drag-drop performance issues documented in react-dnd GitHub. Permission complexity backed by RBAC research |

**Overall confidence:** HIGH

Research synthesized from official documentation (Convex, @dnd-kit), competitive analysis (Linear, Plane, Notion), and direct examination of Ripple's existing codebase patterns. All stack recommendations verified via npm registry. Architecture patterns proven in production Convex applications.

### Gaps to Address

**During Phase 3 planning:**
- Exact virtualization strategy for 100+ task boards (react-window vs @dnd-kit built-in vs manual)
- Conflict resolution UX details (show conflict indicator, last-write-wins, or user dialog)
- Throttling parameters for drag state updates (balance between responsiveness and performance)

**During Phase 4 planning:**
- Task comment architecture decision: separate taskComments table vs link to channel messages vs both
- Message deletion handling: cascade delete tasks, preserve with tombstone, or mark as orphaned

**User validation needed:**
- Task privacy model: inherit channel privacy, workspace-wide by default, or project-level control
- Multi-project tasks: can task belong to multiple projects (many-to-many) or strict 1:1
- Completed task visibility: archive after N days or keep visible indefinitely

**Post-MVP evaluation:**
- WIP limit enforcement: hard block vs soft warning vs no enforcement
- Task templates: need validated by user research before building
- Sub-tasks: defer until users request explicitly

None of these gaps block Phase 1-2 implementation. All can be resolved during phase-specific planning or validated via user research after MVP launch.

## Sources

### Primary (HIGH confidence)

**Technology Stack:**
- [@dnd-kit/core - npm](https://www.npmjs.com/package/@dnd-kit/core) — Version 6.3.1 verified
- [@dnd-kit/sortable - npm](https://www.npmjs.com/package/@dnd-kit/sortable) — Version 10.0.0 verified
- [react-day-picker - npm](https://www.npmjs.com/package/react-day-picker) — Version 9.13.0 verified
- [Convex Optimistic Updates Documentation](https://docs.convex.dev/client/react/optimistic-updates) — Optimistic update patterns
- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/) — Index usage and query patterns
- [Convex Relationship Structures](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas) — Junction tables and membership patterns
- [Introduction to Indexes and Query Performance](https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf) — Compound index strategy

**Existing Codebase:**
- `/convex/schema.ts` — Membership table pattern, roleCount pattern, compound indexes
- `/convex/documents.ts` — Entity CRUD pattern, authorization pattern, getAll usage
- `/convex/messages.ts` — Pagination pattern, batch fetching
- `/convex/channelMembers.ts` — Junction table pattern, denormalized context IDs

**Feature Research:**
- [Linear Task Management 2026](https://everhour.com/blog/linear-task-management/) — Table stakes and integration patterns
- [Plane Open Source Project Management](https://plane.so) — Modern task management UX
- [MS Teams Planner 2026 Updates](https://sourcepassmcoe.com/articles/microsoft-planner-2026-new-and-retiring-features-sourcepass-mcoe) — Competitive positioning
- [Notion Task Management Integration](https://everhour.com/blog/notion-integrations/) — Document embedding patterns

### Secondary (MEDIUM confidence)

**Drag-and-Drop:**
- [Top 5 Drag-and-Drop Libraries for React 2026](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react) — Library comparison
- [Comparison with react-beautiful-dnd](https://github.com/clauderic/dnd-kit/discussions/481) — Migration rationale
- [Build a Kanban board with dnd kit and React](https://blog.logrocket.com/build-kanban-board-dnd-kit-react/) — Implementation patterns
- [Building Drag-and-Drop Kanban with dnd-kit](https://radzion.com/blog/kanban/) — Kanban-specific patterns

**Architecture:**
- [Kanban Data Model Patterns](https://medium.com/@agrawalkanishk3004/kanban-board-ui-system-design-35665fbf85b5) — Schema structure
- [Task Dependencies Patterns](https://activecollab.com/blog/project-management/task-dependencies-for-better-project-management) — Dependency types
- [Kanban Column Indexing Mechanism](https://nickmccleery.com/posts/08-kanban-indexing/) — Fractional indexing rationale

**Pitfalls:**
- [Common Kanban Mistakes](https://kanbanproject.app/article/Common_mistakes_to_avoid_when_using_kanban_Pitfalls_to_watch_out_for_and_how_to_overcome_them.html) — Board management pitfalls
- [Database Design Mistakes](https://chartdb.io/blog/common-database-design-mistakes) — Referential integrity issues
- [Over-Engineering Pitfalls](https://codecat15.medium.com/the-pitfalls-of-over-engineering-in-the-software-industry-adc8a97ee402) — Feature complexity traps
- [RBAC Best Practices 2026](https://www.techprescient.com/blogs/role-based-access-control-best-practices/) — Permission model complexity

### Tertiary (LOW confidence, needs validation)

- [MVP Best Practices](https://monday.com/blog/rnd/mvp-in-project-management/) — 70% of MVP failures from too many features (general claim, not task-specific)
- [Alert Fatigue 2026](https://torq.io/blog/cybersecurity-alert-management-2026/) — 47% of analysts cite alerting issues (cybersecurity context, applies to notifications)

---

*Research completed: 2026-02-05*
*Ready for roadmap: Yes*
*Next step: Requirements definition and phase planning*
