---
phase: 16-auth-resilience
plan: 02
subsystem: collaboration
tags: [security, partykit, permission-validation, websocket, auth]

# Dependency graph
requires:
  - phase: 16-01-websocket-reconnection
    provides: "Dynamic token refresh and connection state tracking"
  - phase: 15-persistence-layer
    provides: "PartyKit server with periodic alarm system"
provides:
  - "Periodic permission re-validation every 30 seconds for all connected users"
  - "Server-to-server auth between PartyKit and Convex for permission checks"
  - "Graceful disconnection with permission_revoked message for revoked users"
affects: [17-graceful-degradation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-to-server auth via PARTYKIT_SECRET for permission validation"
    - "Fail-open pattern for permission checks to avoid disrupting legitimate users"
    - "Piggyback permission checks onto existing periodic alarm system"

key-files:
  created: []
  modified:
    - "convex/collaboration.ts"
    - "convex/http.ts"
    - "partykit/server.ts"
    - "src/hooks/use-yjs-provider.ts"

key-decisions:
  - "Consolidated checkAccess query accepts any resource type (doc/diagram/task) to simplify PartyKit integration"
  - "Piggyback permission checks onto periodic save alarm (30s interval) instead of separate alarm"
  - "Check permissions on reconnect during disconnect debounce window (user rejoins while saving)"
  - "Fail open on permission check errors to prevent disrupting legitimate users during Convex outages"
  - "Frontend sets shouldConnect=false before destroy to prevent reconnection after permission revoked"

patterns-established:
  - "Server-to-server permission validation: PartyKit calls Convex HTTP endpoint with shared secret"
  - "Fail-open security pattern: permission check failures don't disconnect users (availability over strict security)"
  - "Graceful eviction: send typed message before closing connection for better UX"

# Metrics
duration: 3.9min
completed: 2026-02-12
---

# Phase 16 Plan 02: Permission Re-validation on Reconnect Summary

**PartyKit server validates user permissions every 30 seconds and disconnects revoked users with graceful permission_revoked message, preventing unauthorized editing after access removal**

## Performance

- **Duration:** 3.9 min (231 seconds)
- **Started:** 2026-02-12T16:54:38Z
- **Completed:** 2026-02-12T16:58:29Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Convex checkAccess internal query consolidates permission validation for all resource types
- HTTP GET /collaboration/check-access endpoint enables server-to-server permission validation
- PartyKit checks permissions every 30 seconds via periodic alarm (satisfies 60-second requirement)
- Revoked users receive permission_revoked message before disconnection (better UX than abrupt close)
- Frontend prevents reconnection attempts after permission revocation
- Permission check failures fail open to avoid disrupting legitimate users during outages

## Task Commits

Each task was committed atomically:

1. **Task 1: Convex checkAccess query and HTTP endpoint for permission re-validation** - `4aa286e` (feat)
2. **Task 2: PartyKit periodic permission checks and frontend handler** - `d23445b` (feat)

## Files Created/Modified
- `convex/collaboration.ts` - Added checkAccess internal query that validates membership for any resource type
- `convex/http.ts` - Added GET /collaboration/check-access endpoint with PARTYKIT_SECRET authentication
- `partykit/server.ts` - Added checkPermissions method, integrated into periodic and reconnect alarms
- `src/hooks/use-yjs-provider.ts` - Added permission_revoked message handler that stops reconnection

## Decisions Made

**Consolidated checkAccess query:** Instead of three separate queries, one query accepts resourceType discriminant (doc/diagram/task). Simplifies PartyKit integration and reduces code duplication.

**Piggyback on periodic alarm:** Permission checks run every 30 seconds as part of the existing periodic save alarm. This avoids PartyKit's single-alarm-per-room limitation and satisfies the "within 60 seconds" requirement (checks twice per minute).

**Check on reconnect:** When a user reconnects during the disconnect debounce window, run permission check immediately. This catches revocations that happened during the brief disconnection.

**Fail open pattern:** If permission check fails due to network/Convex errors, don't disconnect the user. This prioritizes availability over strict security—legitimate users aren't disrupted by temporary outages. Only disconnect when Convex explicitly returns `hasAccess: false`.

**Frontend reconnection prevention:** Set `newProvider.shouldConnect = false` before calling destroy to prevent y-partykit from attempting automatic reconnection after permission revocation. Without this, the provider would retry connection in an infinite loop.

**Server-to-server auth:** HTTP endpoint validates PARTYKIT_SECRET Bearer token (same pattern as snapshot endpoints). This prevents clients from spoofing permission checks.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tasks completed successfully with zero deviations.

## User Setup Required

None - uses existing PARTYKIT_SECRET environment variable configured in Phase 15.

## Next Phase Readiness

- Permission re-validation complete and verified
- Security gap closed: revoked users disconnected within 60 seconds
- Ready for Phase 17: Graceful Degradation (offline mode, read-only fallback)

---
*Phase: 16-auth-resilience*
*Completed: 2026-02-12*

## Self-Check: PASSED

**Files verified:**
- ✓ convex/collaboration.ts
- ✓ convex/http.ts
- ✓ partykit/server.ts
- ✓ src/hooks/use-yjs-provider.ts

**Commits verified:**
- ✓ 4aa286e (Task 1)
- ✓ d23445b (Task 2)
