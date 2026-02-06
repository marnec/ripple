---
phase: 02-basic-tasks
plan: 04
subsystem: ui
tags: [react, cross-project, my-tasks, sidebar, collapsible, real-time]

# Dependency graph
requires:
  - phase: 02-02
    provides: TaskRow component, hide-completed toggle pattern
  - phase: 02-01
    provides: tasks.listByAssignee query returning enriched tasks with project data
provides:
  - My Tasks cross-project view accessible from sidebar
  - Project-grouped task list with collapsible sections
  - Personal productivity hub showing all assigned tasks
affects: [kanban-board, notifications, task-filtering]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Collapsible project groups (default expanded, track closed instead of open)
    - Cross-project task aggregation by assignee
    - Sidebar standalone link above section lists
    - In-place task detail editing (ready for integration)

key-files:
  created:
    - src/pages/App/Project/MyTasks.tsx
    - src/components/ui/collapsible.tsx
  modified:
    - src/pages/App/AppSidebar.tsx
    - src/routes.tsx

key-decisions:
  - "Track closed groups instead of open groups to avoid setState in useEffect (all groups default to expanded)"
  - "My Tasks positioned above all section lists in sidebar (personal productivity shortcut)"
  - "TODO comment for TaskDetailSheet integration (parallel plan 02-03 creates it)"
  - "selectedTaskId prefixed with underscore until TaskDetailSheet integration complete"

patterns-established:
  - "Cross-project task view: query by assignee with workspaceId filter, group by projectId client-side"
  - "Collapsible project sections: track closed state (inverse of open) for default-expanded behavior"
  - "Sidebar standalone link: SidebarMenu > SidebarMenuItem > SidebarMenuButton with icon and active state"

# Metrics
duration: 5min
completed: 2026-02-06
---

# Phase 02 Plan 04: My Tasks Cross-Project View Summary

**Cross-project task view showing all tasks assigned to current user, grouped by project with collapsible sections, accessible from sidebar above section lists**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-06T08:54:08Z
- **Completed:** 2026-02-06T08:59:09Z
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 2

## Accomplishments

- MyTasks page with cross-project task aggregation using listByAssignee query
- Project-grouped task list with collapsible sections (Collapsible component installed via shadcn)
- Each project group shows color dot, project name, and task count
- Default all groups to expanded (track closedGroups instead of openGroups to avoid setState in useEffect)
- Hide completed toggle with real-time Convex reactive query
- Empty state when no tasks assigned to user
- TaskRow components for each task with onClick handler (ready for TaskDetailSheet integration)
- Sidebar "My Tasks" link with CheckSquare icon positioned above all section lists
- Active state highlighting when on My Tasks route
- Route added at /workspaces/:workspaceId/my-tasks
- Mobile sidebar closes on navigation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create MyTasks page with project-grouped task list** - `3144464` (feat)
2. **Task 2: Add My Tasks to sidebar and routing** - `47f378c` (feat)

## Files Created/Modified

**Created:**
- `src/pages/App/Project/MyTasks.tsx` - Cross-project task view showing all tasks assigned to current user, grouped by project with collapsible sections, hide-completed toggle, empty state, and TODO for TaskDetailSheet integration
- `src/components/ui/collapsible.tsx` - shadcn Collapsible component for expandable project groups

**Modified:**
- `src/pages/App/AppSidebar.tsx` - Added "My Tasks" link above section lists with CheckSquare icon, active state detection, and navigation handler
- `src/routes.tsx` - Added /my-tasks route under workspace children (before channels section)

## Decisions Made

**Track closed groups instead of open groups:**
Initial implementation used useEffect to initialize all groups as open, which triggered ESLint error about setState in effect. Refactored to track closedGroups Set instead, with default state of empty Set (all groups open). Toggle logic inverted: `isOpen = !closedGroups.has(projectId)`. This avoids the useEffect pattern entirely while achieving the same UX (all groups default to expanded).

**My Tasks positioned above all section lists:**
My Tasks is a personal productivity shortcut, not a workspace section. Positioned above ChannelSelectorList, ProjectSelectorList, etc. in the sidebar. Uses standalone SidebarMenu > SidebarMenuItem pattern rather than being part of any section group.

**TODO comment for TaskDetailSheet integration:**
Plan 02-03 is running in parallel and creates TaskDetailSheet.tsx. To avoid file conflicts, MyTasks.tsx leaves a TODO comment where TaskDetailSheet should be rendered. The selectedTaskId state is prefixed with underscore to suppress unused variable warnings until integration is complete. The orchestrator will handle integration after both plans complete.

**Project grouping logic:**
Use useMemo to group tasks by projectId, creating ProjectGroup objects with projectName, projectColor, and tasks array. Project metadata (name, color) comes from enriched task data returned by listByAssignee query. Each group renders as a Collapsible with header (chevron, color dot, project name, badge count) and content (TaskRow list).

## Deviations from Plan

None - plan executed exactly as written. The plan correctly anticipated the parallel execution with plan 02-03 and instructed leaving a TODO comment for TaskDetailSheet integration.

## Issues Encountered

**ESLint error: setState in useEffect (auto-fixed per Rule 1):**
Initial implementation used useEffect to initialize openGroups state when groupedTasks changed. ESLint flagged this as "Calling setState synchronously within an effect can trigger cascading renders."

**Resolution:** Refactored to track closedGroups instead of openGroups, with empty Set as default state. This achieves the same UX (all groups expanded by default) without needing useEffect. Toggle logic inverted: `isOpen = !closedGroups.has(projectId)`.

**Impact:** Pure refactor with identical behavior. All groups still default to expanded, users can collapse/expand as needed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- My Tasks cross-project view complete and accessible from sidebar
- Ready for TaskDetailSheet integration from plan 02-03
- Task clicking sets selectedTaskId (prepared for sheet rendering)
- Real-time updates working via Convex reactive queries
- Collapsible pattern established for grouped list views
- Future enhancements: filters (by project, by priority, by due date), sorting options, task creation from My Tasks

## Self-Check: PASSED

All created files verified:
- src/pages/App/Project/MyTasks.tsx - FOUND
- src/components/ui/collapsible.tsx - FOUND

All commits verified:
- 3144464 - FOUND
- 47f378c - FOUND

---
*Phase: 02-basic-tasks*
*Completed: 2026-02-06*
