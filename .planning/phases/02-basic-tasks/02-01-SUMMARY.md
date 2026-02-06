---
phase: 02-basic-tasks
plan: 01
subsystem: database
tags: [convex, schema, tasks, taskStatuses, backend, crud]

# Dependency graph
requires: [01-projects-foundation]
provides:
  - tasks table with 6 indexes for efficient queries
  - taskStatuses table with workspace-scoped customizable statuses
  - TaskPriority enum (urgent, high, medium, low)
  - Task CRUD operations with permission checks
  - Status CRUD operations with default seeding
  - Cross-project task queries (listByAssignee for My Tasks)
affects: [02-basic-tasks, ui-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - workspace-scoped customizable statuses with default seeding
    - denormalized completed field for efficient filtering
    - enriched queries returning related entities (status, assignee, project)
    - inline default status seeding on first task creation
    - freeform string array labels (matches documents.tags pattern)

key-files:
  created:
    - convex/tasks.ts
    - convex/taskStatuses.ts
    - shared/enums/taskPriority.ts
  modified:
    - convex/schema.ts
    - shared/enums/index.ts

key-decisions:
  - "Inline status seeding in tasks.create mutation (can't call mutations from mutations)"
  - "Freeform string labels array instead of workspace-scoped label entities for v1"
  - "Denormalized completed field on tasks for efficient hideCompleted filtering"
  - "listByAssignee filters by workspaceId after query (no compound index for workspace+assignee)"
  - "Enriched queries return nested objects with status/assignee/project data"

patterns-established:
  - "Customizable status architecture: separate table with seeding, isDefault and isCompleted flags"
  - "Permission validation: check projectMembers.by_project_user before all task mutations"
  - "Query enrichment: use Promise.all to fetch related entities and return nested objects"
  - "Default seeding: inline logic with existence check (no-op if already seeded)"

# Metrics
duration: 3min
completed: 2026-02-06
---

# Phase 02 Plan 01: Task Backend Foundation Summary

**Task schema with CRUD operations, customizable statuses with default seeding, priority enum, and cross-project queries**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-06T08:37:14Z
- **Completed:** 2026-02-06T08:40:02Z
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 2

## Accomplishments

- tasks table with projectId, workspaceId, title, description, statusId, assigneeId, priority, labels, completed, creatorId
- taskStatuses table with workspace-scoped customizable statuses (name, color, order, isDefault, isCompleted)
- TaskPriority enum with urgent/high/medium/low values
- 6 indexes on tasks table: by_project, by_project_completed, by_assignee, by_assignee_completed, by_project_status, by_workspace
- 2 indexes on taskStatuses table: by_workspace, by_workspace_order
- Full task CRUD with permission checks and enriched queries
- Status CRUD with validation (cannot remove default or in-use statuses)
- Default status seeding (To Do, In Progress, Done) on first task creation per workspace
- Cross-project query (listByAssignee) for My Tasks view with project data

## Task Commits

Each task was committed atomically:

1. **Task 1: Add tasks and taskStatuses tables to schema + priority enum** - `4314184` (feat)
2. **Task 2: Create taskStatuses.ts and tasks.ts with full CRUD operations** - `0d17dca` (feat)

## Files Created/Modified

**Created:**
- `shared/enums/taskPriority.ts` - TaskPriority enum with 4 priority levels
- `convex/taskStatuses.ts` - Status CRUD and default seeding (5 exported functions)
- `convex/tasks.ts` - Task CRUD operations (6 exported functions)

**Modified:**
- `convex/schema.ts` - Added tasks and taskStatuses table definitions with indexes
- `shared/enums/index.ts` - Added taskPriority export

## Decisions Made

**Inline status seeding approach:**
Cannot call mutations from other mutations in Convex, so tasks.create includes inline logic to seed default statuses when they don't exist. This ensures first task creation in a workspace automatically sets up the default statuses (To Do, In Progress, Done).

**Freeform labels for v1:**
Using `labels: v.optional(v.array(v.string()))` instead of workspace-scoped label entities with colors. This matches the existing documents.tags pattern and reduces complexity for v1. Can migrate to label entities in Phase 3+ when building label management UI.

**Denormalized completed field:**
Tasks have a `completed: v.boolean()` field that mirrors `status.isCompleted`. This allows efficient filtering with the by_project_completed index without joining to taskStatuses table on every query. Updated automatically when status changes in tasks.update mutation.

**listByAssignee filtering strategy:**
Query uses by_assignee or by_assignee_completed index, then filters results to specified workspaceId. No compound index for (assigneeId, workspaceId, completed) since cross-workspace task assignment is rare. Simpler index strategy trades minor query performance for clearer schema.

**Enriched query pattern:**
All list queries (listByProject, listByAssignee) return enriched objects with nested status, assignee, and project data. This reduces frontend complexity (no need to make separate queries for relations) at the cost of slightly larger payloads. Using v.any() return validator instead of complex nested object validators.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tasks completed without issues. TypeScript compilation and ESLint checks passed on both commits.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Backend foundation complete for task management
- Ready for frontend UI integration (task list, inline creation, detail sheet, My Tasks view)
- Status customization UI can be built in Phase 3 (CRUD operations exist)
- Label management can be deferred to Phase 3+ (freeform labels working for v1)
- All queries and mutations enforcing proper permissions

## Self-Check: PASSED

All created files verified:
- shared/enums/taskPriority.ts - FOUND
- convex/taskStatuses.ts - FOUND
- convex/tasks.ts - FOUND

All commits verified:
- 4314184 - FOUND
- 0d17dca - FOUND

---
*Phase: 02-basic-tasks*
*Completed: 2026-02-06*
