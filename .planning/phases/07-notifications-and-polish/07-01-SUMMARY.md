---
phase: 07-notifications-and-polish
plan: 01
subsystem: notifications
tags: [web-push, VAPID, blocknote, push-notifications, internal-actions]

# Dependency graph
requires:
  - phase: 06.1-mention-people-in-task-comments
    provides: BlockNote JSON schema with userMention inline content
provides:
  - BlockNote JSON parser utility (extractMentionedUserIds)
  - Task assignment push notification internal action
  - User mention push notification internal action
affects: [07-02-trigger-notifications, notifications, task-lifecycle]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Internal actions for notification delivery", "Graceful VAPID error handling", "BlockNote JSON recursive traversal"]

key-files:
  created:
    - convex/utils/blocknote.ts
    - convex/taskNotifications.ts
  modified: []

key-decisions:
  - "Graceful VAPID error handling with console.error instead of throwing (missing env vars don't crash app)"
  - "mentionedUserIds as v.array(v.string()) not v.array(v.id('users')) because IDs come from JSON parsing"
  - "Promise.allSettled for notification sending (individual failures don't block other sends)"
  - "Reuse exact VAPID pattern from existing pushNotifications.ts for consistency"

patterns-established:
  - "BlockNote JSON traversal: recursively walk blocks → content → children for inline content extraction"
  - "Internal action notification pattern: query user subscriptions → setup VAPID → Promise.allSettled sends"
  - "Type narrowing via type assertion for discriminated union inline content"

# Metrics
duration: 2min
completed: 2026-02-06
---

# Phase 07 Plan 01: Notification Infrastructure Summary

**BlockNote JSON parser extracting @mentions and two internal actions delivering task assignment and mention push notifications via web-push**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-06T22:03:10Z
- **Completed:** 2026-02-06T22:05:35Z
- **Tasks:** 2
- **Files modified:** 2 created

## Accomplishments
- BlockNote JSON parser recursively extracts all @mentioned user IDs from task descriptions and comments
- Task assignment notification action sends push to assignee with task context and deep link
- User mention notification action sends push to all mentioned users with context (task description vs comment)
- Both actions gracefully handle missing VAPID env vars without crashing

## Task Commits

Each task was committed atomically:

1. **Task 1: Create BlockNote mention extraction utility** - `5ea40f4` (feat)
2. **Task 2: Create task notification internal actions** - `e344abc` (feat)

## Files Created/Modified
- `convex/utils/blocknote.ts` - Recursively parses BlockNote JSON to extract userMention IDs from nested block structure
- `convex/taskNotifications.ts` - Internal actions for task assignment and user mention push notifications using web-push

## Decisions Made

**Graceful VAPID error handling** - Use console.error instead of throwing when VAPID env vars are missing. This prevents the app from crashing during development or in environments where push notifications aren't configured. Notification actions return null silently when credentials are unavailable.

**mentionedUserIds as string array** - The `notifyUserMentions` action accepts `v.array(v.string())` rather than `v.array(v.id("users"))` because the user IDs come from JSON parsing (extractMentionedUserIds returns strings). Cast to `Id<"users">[]` via `as any` when passing to query since the strings are valid Convex IDs from the database.

**Promise.allSettled for parallel sends** - Both notification actions use Promise.allSettled to send to multiple subscriptions in parallel. Individual send failures are logged but don't prevent other notifications from being delivered.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**TypeScript type narrowing for discriminated unions** - Initial implementation failed TypeScript compilation because checking `item.type === "userMention"` didn't narrow the union type automatically. Fixed by using explicit type assertion: `const mention = item as { type: "userMention"; props: { userId: string } }` after the type check.

## User Setup Required

None - no external service configuration required. VAPID credentials are already configured from existing push notification infrastructure.

## Next Phase Readiness

- Notification delivery infrastructure ready for Plan 02 to schedule from task/comment mutations
- extractMentionedUserIds utility available for both task description updates and comment creation
- Deep link URL pattern established: `/workspaces/{workspaceId}/projects/{projectId}?task={taskId}`
- Ready to integrate with task assignment, description updates, and comment creation workflows

---
*Phase: 07-notifications-and-polish*
*Completed: 2026-02-06*

## Self-Check: PASSED
