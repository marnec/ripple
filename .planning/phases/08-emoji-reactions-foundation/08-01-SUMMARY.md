---
phase: 08-emoji-reactions-foundation
plan: 01
subsystem: database
tags: [convex, schema, messageReactions, emoji, real-time]

# Dependency graph
requires:
  - phase: 07-notifications-polish
    provides: Push notification infrastructure used by v0.8
provides:
  - messageReactions table with compound indexes for idempotent toggle
  - Backend API for emoji reactions (toggle mutation, listForMessage aggregation query)
affects: [08-02, phase-09, phase-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Idempotent toggle pattern with compound unique index
    - JavaScript aggregation for grouped reactions with counts

key-files:
  created:
    - convex/messageReactions.ts
  modified:
    - convex/schema.ts
    - tsconfig.app.json

key-decisions:
  - "Use by_message_emoji_user compound index for idempotent toggle (prevents race condition duplicates)"
  - "JavaScript aggregation in listForMessage query (efficient for typical reaction counts)"
  - "Returns v.any() for complex enriched return type (per project convention)"

patterns-established:
  - "Toggle pattern: Check existence with compound unique index, delete if exists, insert if not"
  - "Aggregation pattern: Fetch all via by_message index, reduce to grouped counts, add currentUserReacted flag"

# Metrics
duration: 1.5min
completed: 2026-02-07
---

# Phase 08 Plan 01: Backend Schema and CRUD Summary

**messageReactions table with idempotent toggle mutation and aggregation query for emoji reactions on messages**

## Performance

- **Duration:** 1.5 min
- **Started:** 2026-02-07T21:49:17Z
- **Completed:** 2026-02-07T21:50:44Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- messageReactions table added to Convex schema with messageId, userId, emoji, emojiNative fields
- Compound indexes (by_message, by_message_emoji_user) for efficient querying and idempotency
- Toggle mutation handles add/remove reactions idempotently (no race condition duplicates)
- listForMessage query returns aggregated reactions grouped by emoji with counts and currentUserReacted flag

## Task Commits

Each task was committed atomically:

1. **Task 1: Add messageReactions table to Convex schema** - `ec9775b` (feat)
2. **Task 2: Create messageReactions.ts with toggle mutation and listForMessage query** - `b04076c` (feat)

## Files Created/Modified
- `convex/schema.ts` - Added messageReactions table with by_message and by_message_emoji_user indexes
- `convex/messageReactions.ts` - Toggle mutation and listForMessage aggregation query
- `tsconfig.app.json` - Fixed to include convex/utils/blocknote.ts (pre-existing TypeScript config issue)

## Decisions Made
- **Compound unique index for idempotency:** Used by_message_emoji_user index (messageId, emoji, userId) to make toggle mutation idempotent, preventing race condition duplicates when users rapidly click reaction pills
- **JavaScript aggregation over SQL-style joins:** Convex doesn't support SQL-style GROUP BY, so used JavaScript reduce() to group reactions by emoji - efficient for typical message reaction counts (<1000 per message)
- **v.any() for enriched returns:** Followed project convention of using v.any() for complex return types with aggregated data (currentUserReacted flag added after aggregation)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed TypeScript config to include convex/utils/blocknote.ts**
- **Found during:** Task 1 (npm run lint verification)
- **Issue:** tsconfig.app.json was missing convex/utils/blocknote.ts in include array, causing TypeScript compilation error: "File is not listed within the file list of project"
- **Fix:** Added "convex/utils/blocknote.ts" to tsconfig.app.json include array
- **Files modified:** tsconfig.app.json
- **Verification:** npm run lint passed with 0 warnings
- **Committed in:** ec9775b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix necessary to unblock lint verification. No scope creep - pre-existing config issue from Phase 06.1 when blocknote utils were added.

## Issues Encountered
None - tasks executed as planned after fixing TypeScript config.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Backend data layer complete for emoji reactions
- Ready for Phase 08 Plan 02: Frontend reaction UI (emoji picker, pills, tooltips, Message.tsx integration)
- All indexes in place for efficient real-time reaction updates
- Toggle mutation tested via lint, ready for frontend consumption

## Self-Check: PASSED

All files and commits verified successfully.
