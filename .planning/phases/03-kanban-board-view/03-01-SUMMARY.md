---
phase: 03-kanban-board-view
plan: 01
subsystem: database
tags: [convex, fractional-indexing, dnd-kit, drag-drop, kanban, task-ordering]

# Dependency graph
requires:
  - phase: 02-basic-tasks
    provides: tasks table, taskStatuses table, task CRUD operations
provides:
  - position field on tasks table for fractional indexing
  - by_project_status_position index for efficient position-based queries
  - updatePosition mutation for lightweight drag-drop updates
  - reorderColumns mutation for status column reordering
  - dnd-kit and fractional-indexing libraries installed
affects: [03-02-kanban-ui, future-kanban-features]

# Tech tracking
tech-stack:
  added: [@dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, fractional-indexing]
  patterns: [fractional indexing for task ordering, position-based sorting in queries]

key-files:
  created: []
  modified: [convex/schema.ts, convex/tasks.ts, convex/taskStatuses.ts, package.json]

key-decisions:
  - "position field is v.optional() for backward compatibility with existing tasks"
  - "generateKeyBetween auto-calculates position at end of status column when not provided"
  - "listByProject sorts by position with _creationTime fallback for legacy tasks"
  - "updatePosition mutation dedicated to drag-drop for performance (only updates statusId, position, completed)"

patterns-established:
  - "Pattern 1: Fractional indexing via generateKeyBetween for flexible ordering without renumbering"
  - "Pattern 2: Optional position field allows graceful migration from unordered to ordered data"
  - "Pattern 3: Dedicated lightweight mutations for high-frequency operations (updatePosition for drag-drop)"

# Metrics
duration: 2min
completed: 2026-02-06
---

# Phase 03 Plan 01: Task Ordering Infrastructure Summary

**Fractional indexing position field with by_project_status_position index, auto-position calculation in create, and updatePosition mutation for drag-drop**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-06T10:00:25Z
- **Completed:** 2026-02-06T10:02:31Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- position field added to tasks table using fractional-indexing for flexible ordering
- by_project_status_position index enables efficient position-based queries
- tasks.create auto-calculates position at end of status column using generateKeyBetween
- updatePosition mutation provides lightweight drag-drop updates (statusId + position + completed)
- reorderColumns mutation enables bulk status column reordering
- listByProject sorts by position with _creationTime fallback for backward compatibility

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dnd-kit and fractional-indexing dependencies** - `db0d7bb` (chore)
2. **Task 2: Add position field to schema and update backend mutations** - `1cb7098` (feat)

## Files Created/Modified
- `package.json` - Added @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, fractional-indexing dependencies
- `convex/schema.ts` - Added position field (v.optional(v.string())) and by_project_status_position index to tasks table
- `convex/tasks.ts` - Updated create/update mutations for position, added updatePosition mutation, updated listByProject sorting
- `convex/taskStatuses.ts` - Added reorderColumns mutation for bulk column reorder

## Decisions Made
- **position as v.optional():** Existing tasks without position values sort correctly via fallback to _creationTime, ensuring backward compatibility
- **Auto-calculate position in create:** When position not provided, query existing tasks in same status and use generateKeyBetween(lastTask?.position ?? null, null) to append at end
- **Dedicated updatePosition mutation:** Separate from general update mutation for performance - drag-drop only needs statusId, position, and completed fields
- **localeCompare for position sorting:** Empty string for undefined positions ensures tasks without position sort after positioned tasks

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Backend infrastructure complete for Kanban board. Ready for:
- Plan 02: Kanban UI implementation with dnd-kit drag-drop
- Real-time position updates via Convex reactivity
- Column-based task organization with drag-to-reorder

All mutations tested via lint checks (TypeScript compilation successful).

---
*Phase: 03-kanban-board-view*
*Completed: 2026-02-06*

## Self-Check: PASSED
