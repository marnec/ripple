---
phase: 02-basic-tasks
plan: 02
subsystem: ui
tags: [react, shadcn, badge, task-list, inline-creation, real-time]

# Dependency graph
requires:
  - phase: 02-01
    provides: tasks.listByProject query, tasks.create mutation, enriched task data with status/assignee
provides:
  - Task list UI with hide-completed toggle
  - Inline task creation with rapid entry pattern
  - Compact task rows showing priority, status, assignee
  - Badge component for status indicators
  - Empty state for zero tasks
affects: [02-basic-tasks, task-detail-sheet, kanban-board]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Inline creation pattern with Plus icon and dashed border input
    - Compact row layout (GitHub Issues style) for list items
    - Badge with colored dot indicator (avoids contrast issues)
    - Hide-completed toggle with Checkbox + Label
    - Real-time updates via Convex reactive queries

key-files:
  created:
    - src/components/ui/badge.tsx
    - src/pages/App/Project/TaskRow.tsx
    - src/pages/App/Project/CreateTaskInline.tsx
    - src/pages/App/Project/Tasks.tsx
  modified:
    - src/pages/App/Project/ProjectDetails.tsx
    - convex/taskStatuses.ts
    - convex/tasks.ts

key-decisions:
  - "Status badge uses colored dot indicator instead of colored background (avoids contrast issues)"
  - "Hide-completed defaults to true (users see active tasks first)"
  - "Inline creation clears and refocuses input after submit (rapid entry pattern)"
  - "Priority icons use color and shape for visual distinction (urgent=red AlertCircle, high=orange ArrowUp, medium=yellow Minus, low=gray ArrowDown)"

patterns-established:
  - "Inline creation: form with dashed border input, Plus icon, Enter to submit, clear and refocus"
  - "Compact row: flex row with icon, title (truncated), badges, avatar - GitHub Issues style"
  - "Real-time list: useQuery with hideCompleted param, maps to row components"
  - "Empty state: centered icon + heading + subtext pattern"

# Metrics
duration: 5min
completed: 2026-02-06
---

# Phase 02 Plan 02: Task List UI Summary

**GitHub Issues-style task list with inline creation, hide-completed toggle, priority icons, status badges, and real-time updates via Convex reactive queries**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-06T08:43:06Z
- **Completed:** 2026-02-06T08:48:53Z
- **Tasks:** 2
- **Files created:** 4
- **Files modified:** 3

## Accomplishments

- Badge component installed via shadcn CLI for status indicators
- TaskRow component with compact GitHub Issues-style layout (priority icon, title with strikethrough for completed, status badge with color dot, assignee avatar)
- CreateTaskInline component with Plus icon, dashed border input, Enter to submit, toast error handling, auto-clear and refocus for rapid entry
- Tasks.tsx main list view with header (task count badge), hide-completed checkbox toggle (defaults to true), inline creation, task list, empty state, loading state
- ProjectDetails integration replacing placeholder content with working task list
- Real-time updates via Convex reactive queries (tasks appear immediately on creation)
- Fixed two backend TypeScript bugs from plan 02-01 (incorrect index usage, wrong type annotations)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Badge component and create TaskRow + CreateTaskInline components** - `23f463d` (feat)
2. **Backend bug fixes** - `a97f017` (fix) - Rule 1 deviation
3. **Task 2: Create Tasks.tsx list view and integrate into ProjectDetails** - `9ceb577` (feat)

## Files Created/Modified

**Created:**
- `src/components/ui/badge.tsx` - shadcn Badge component for status indicators with variants (default, secondary, destructive, outline)
- `src/pages/App/Project/TaskRow.tsx` - Compact task row with priority icon (color-coded: urgent=red, high=orange, medium=yellow, low=gray), title (strikethrough when completed), status badge with colored dot, assignee avatar
- `src/pages/App/Project/CreateTaskInline.tsx` - Inline task creation form with Plus icon, dashed border input, Enter to submit, toast errors, auto-clear and refocus
- `src/pages/App/Project/Tasks.tsx` - Main task list view with header (title + count badge), hide-completed toggle, inline creation, task rows, empty state, loading state

**Modified:**
- `src/pages/App/Project/ProjectDetails.tsx` - Integrated Tasks component, removed placeholder "Kanban coming soon" content
- `convex/taskStatuses.ts` - Fixed incorrect index usage in remove function (Rule 1 deviation)
- `convex/tasks.ts` - Fixed type mismatch in update mutation patch object (Rule 1 deviation)

## Decisions Made

**Status badge colored dot pattern:**
Using a small colored dot (4px circle) before status text instead of colored background. This avoids contrast issues with light/dark mode and allows status colors to be visible without affecting text readability. Badge uses variant="secondary" for consistent background.

**Hide-completed defaults to true:**
Users see active tasks first when opening a project. They can toggle to show completed tasks if needed. This matches common task management UX patterns (Asana, Linear, GitHub Issues).

**Rapid entry pattern with auto-refocus:**
After creating a task via Enter, the input clears and refocuses automatically. This enables users to quickly add multiple tasks in succession without clicking back into the input field each time.

**Priority icon visual system:**
Each priority level has distinct color AND icon shape for accessibility:
- urgent: red AlertCircle (circular warning)
- high: orange ArrowUp (directional emphasis)
- medium: yellow Minus (neutral horizontal line)
- low: gray ArrowDown (de-emphasized)

This dual-coding (color + shape) works for colorblind users and provides clear visual hierarchy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect index usage in taskStatuses.remove**
- **Found during:** Task 2 (TypeScript compilation check before committing)
- **Issue:** taskStatuses.remove query used `by_project_status` index with only statusId, but this compound index requires projectId as first parameter. TypeScript error: Argument of type '"statusId"' is not assignable to parameter of type '"projectId"'.
- **Fix:** Changed to use `by_workspace` index with workspace filter, then filter results by statusId. This correctly queries all tasks in the workspace and checks if any use the status being deleted.
- **Files modified:** convex/taskStatuses.ts (lines 185-188)
- **Verification:** TypeScript compilation passes, query logic correct
- **Committed in:** a97f017 (separate fix commit)

**2. [Rule 1 - Bug] Fixed type mismatch in tasks.update patch object**
- **Found during:** Task 2 (TypeScript compilation check before committing)
- **Issue:** Patch object in tasks.update mutation declared statusId and assigneeId as `string` types, but should be `Id<"taskStatuses">` and `Id<"users">` respectively. TypeScript error: Type 'string' is not assignable to parameter of type 'Id<"taskStatuses">'.
- **Fix:** Added `Id` import from `_generated/dataModel` and updated patch object type annotation to use proper Id types for statusId and assigneeId fields.
- **Files modified:** convex/tasks.ts (lines 1-4, 298-306)
- **Verification:** TypeScript compilation passes, type safety restored
- **Committed in:** a97f017 (separate fix commit)

---

**Total deviations:** 2 auto-fixed (2 bugs from plan 02-01)
**Impact on plan:** Both auto-fixes were necessary for TypeScript compilation. These were latent bugs in the backend code from the previous plan that only surfaced when the dev server attempted to compile all code. No scope creep - pure bug fixes.

## Issues Encountered

None during UI implementation. All components rendered correctly, TypeScript and ESLint checks passed after fixing the backend bugs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Task list UI complete and functional for viewing and creating tasks
- Ready for Plan 03 (Task Detail Sheet with edit/delete/status/priority/assignee controls)
- Ready for Plan 04 (My Tasks cross-project view)
- Kanban board (Phase 3) can reuse TaskRow component for board cards
- Real-time updates working via Convex - no polling needed

## Self-Check: PASSED

All created files verified:
- src/components/ui/badge.tsx - FOUND
- src/pages/App/Project/TaskRow.tsx - FOUND
- src/pages/App/Project/CreateTaskInline.tsx - FOUND
- src/pages/App/Project/Tasks.tsx - FOUND

All commits verified:
- 23f463d - FOUND
- a97f017 - FOUND
- 9ceb577 - FOUND

---
*Phase: 02-basic-tasks*
*Completed: 2026-02-06*
