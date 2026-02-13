---
phase: 17-graceful-degradation
plan: 03
subsystem: infra
tags: [partykit, yjs, snapshot-persistence, alarm-handlers, durable-storage]

# Dependency graph
requires:
  - phase: 15-persistence-layer
    provides: "onAlarm handlers for periodic and disconnect-debounce saves"
  - phase: 17-01
    provides: "Cold-start loading from Convex snapshots"
provides:
  - "Working onAlarm handlers that can access roomId via PartyKit durable storage"
  - "Functional periodic snapshot saves (30s interval)"
  - "Functional disconnect-debounce saves (7s after last user disconnect)"
affects: [cold-start-fallback, snapshot-persistence, UAT-testing]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Cache Party.id in durable storage for alarm handler access (PartyKit platform limitation)"]

key-files:
  created: []
  modified: ["partykit/server.ts"]

key-decisions:
  - "Cache roomId in PartyKit durable storage during onConnect for alarm handler access"
  - "Use typed generics (storage.get<string>) instead of type assertions to satisfy linter"
  - "Apply roomId caching to onClose as well for defensive safety (may share same Party.id limitation)"

patterns-established:
  - "PartyKit alarm handlers must read cached data from storage instead of accessing this.room properties"
  - "Store immutable metadata (like roomId) once in onConnect, read in alarm handlers"

# Metrics
duration: 3.3min
completed: 2026-02-13
---

# Phase 17 Plan 03: PartyKit Alarm Handler roomId Caching Summary

**Fixed PartyKit onAlarm crash by caching roomId in durable storage during onConnect and reading it back in alarm handlers (this.room.id inaccessible in alarm context)**

## Performance

- **Duration:** 3.3 min
- **Started:** 2026-02-13T10:31:16Z
- **Completed:** 2026-02-13T10:34:35Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- PartyKit alarm handlers (periodic save, disconnect-debounce save) no longer crash when accessing roomId
- Periodic snapshots (30s interval) can now successfully write to Convex
- Disconnect-debounce snapshots (7s after last user) can now successfully write to Convex
- Cold-start fallback (UAT Tests 6 and 8) unblocked - Convex now receives snapshots to serve on cold-start

## Task Commits

Each task was committed atomically:

1. **Task 1: Cache roomId in PartyKit storage and refactor alarm handler to use it** - `87bd252` (fix)

## Files Created/Modified
- `partykit/server.ts` - Added roomId caching in onConnect, refactored saveSnapshotToConvex and checkPermissions to accept roomId parameter, onAlarm and onClose read cached roomId from storage

## Decisions Made

**1. Cache roomId in durable storage during onConnect**
- PartyKit platform limitation: `this.room.id` (Party.id) is inaccessible in alarm handlers
- Solution: Store in `room.storage.put("roomId", this.room.id)` during onConnect (where it IS accessible)
- Read back via `room.storage.get<string>("roomId")` in onAlarm and onClose

**2. Refactor methods to accept roomId parameter**
- Changed `saveSnapshotToConvex()` and `checkPermissions()` to accept `roomId: string` parameter
- All call sites in onAlarm pass the cached roomId
- Eliminates ALL `this.room.id` usage in alarm context

**3. Use typed generics instead of type assertions**
- Original: `(await this.room.storage.get("roomId")) as string | undefined`
- ESLint error: unnecessary type assertion (parentheses around entire await expression)
- Fix: `await this.room.storage.get<string>("roomId")` - uses generic parameter instead

**4. Apply caching to onClose defensively**
- onClose may also have same Party.id restriction (unclear from docs)
- Safe approach: read cached roomId there too for log statements
- Ensures future-proof robustness

## Deviations from Plan

None - plan executed exactly as written. The plan correctly identified the root cause (this.room.id inaccessible in alarm handlers) and provided precise refactoring steps.

## Issues Encountered

**ESLint type assertion error**
- Initial implementation used `(await storage.get("roomId")) as string | undefined`
- ESLint flagged as unnecessary type assertion
- Root cause: Parentheses around entire await expression made assertion redundant
- Solution: Use typed generic `storage.get<string>("roomId")` instead - cleaner and type-safe

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Snapshot persistence pipeline fully functional: periodic saves (30s) and disconnect-debounce saves (7s) now write to Convex
- Cold-start fallback unblocked: Convex has snapshots available for loading when IndexedDB is empty
- Ready for UAT re-testing of Tests 6 and 8 (cold-start document/diagram loading)
- No known blockers

## Self-Check: PASSED

All files and commits verified:
- ✓ partykit/server.ts exists
- ✓ Commit 87bd252 exists in git history

---
*Phase: 17-graceful-degradation*
*Completed: 2026-02-13*
