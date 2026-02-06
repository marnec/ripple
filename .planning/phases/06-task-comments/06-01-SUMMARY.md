---
phase: 06-task-comments
plan: 01
subsystem: collaboration
tags: [convex, react, comments, real-time, soft-delete]

# Dependency graph
requires:
  - phase: 02-basic-tasks
    provides: tasks schema, task CRUD operations, permission patterns
  - phase: 01-projects-foundation
    provides: projectMembers table with by_project_user index
provides:
  - taskComments table with CRUD operations
  - Real-time comment updates via Convex reactivity
  - Author-only edit and delete permissions
  - TaskComments component with inline editing
affects: [07-task-activity-feed]

# Tech tracking
tech-stack:
  added: []
  patterns: [soft-delete comments, author-only permissions, chronological ordering]

key-files:
  created:
    - convex/taskComments.ts
    - src/pages/App/Project/TaskComments.tsx
  modified:
    - convex/schema.ts
    - src/pages/App/Project/TaskDetailSheet.tsx
    - src/pages/App/Project/TaskDetailPage.tsx

key-decisions:
  - "Soft-delete for comments (reversible, maintains history)"
  - "Chronological order (oldest first) for conversation flow"
  - "Author-only edit/delete (no project admin override)"
  - "Ctrl+Enter keyboard shortcut for comment submission"

patterns-established:
  - "Soft-delete pattern: deleted boolean field with undeleted_by_X indexes"
  - "Author enrichment via batch fetch with getAll() from convex-helpers"
  - "Inline edit mode with Save/Cancel buttons for comment editing"

# Metrics
duration: 3min
completed: 2026-02-06
---

# Phase 06 Plan 01: Task Comments Summary

**Real-time task comments with soft-delete, author permissions, and inline editing integrated into task detail views**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-06T20:28:47Z
- **Completed:** 2026-02-06T20:32:38Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Backend taskComments table with by_task and undeleted_by_task indexes
- CRUD operations (list, create, update, remove) with project membership checks
- TaskComments component with chronological display, author avatars, and timestamps
- Inline editing for comment authors with textarea and Save/Cancel buttons
- Soft-delete for comment authors (no confirmation dialog needed)
- Integration into both TaskDetailSheet and TaskDetailPage below description section

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend - taskComments schema and CRUD operations** - `69a030f` (feat)
2. **Task 2: Frontend - TaskComments component and integration** - `04f5018` (feat)

## Files Created/Modified
- `convex/schema.ts` - Added taskComments table definition with indexes
- `convex/taskComments.ts` - CRUD operations with permission checks and author enrichment
- `src/pages/App/Project/TaskComments.tsx` - Comment list and input component with inline editing
- `src/pages/App/Project/TaskDetailSheet.tsx` - Integrated TaskComments component below description
- `src/pages/App/Project/TaskDetailPage.tsx` - Integrated TaskComments component below description

## Decisions Made

1. **Soft-delete pattern for comments** - Using `deleted: boolean` field with `undeleted_by_task` index allows comments to be hidden from users while maintaining data integrity and enabling potential recovery. Matches the pattern established in messages table.

2. **Chronological order (oldest first)** - Comments ordered by `_creationTime` ascending creates a natural conversation flow, different from messages which show newest first for chat context.

3. **Author-only permissions** - Only comment authors can edit or delete their own comments. No override for project admins or workspace owners. This maintains clear ownership and prevents accidental modifications.

4. **Ctrl+Enter keyboard shortcut** - Allows power users to submit comments quickly without clicking the button, matching common conventions in chat/comment interfaces.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**TypeScript eslint warnings for async onClick handlers** - Fixed by changing async functions to void-returning functions that use `void promise.then()` pattern instead of `await`. This matches the codebase convention for React event handlers.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Task comments fully functional and integrated into task detail views
- Real-time updates work via Convex reactivity
- Ready for activity feed integration (Phase 07) to show comment creation/editing events
- No blockers or concerns

## Self-Check: PASSED

All created files exist and all commits are present in git history.

---
*Phase: 06-task-comments*
*Completed: 2026-02-06*
