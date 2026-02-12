---
phase: 15-persistence-layer
plan: 02
subsystem: backend-realtime
tags: [partykit, yjs, persistence, alarms, durable-objects]

dependency_graph:
  requires: [15-01]
  provides: [partykit-snapshot-lifecycle]
  affects: [collaboration-server, data-durability]

tech_stack:
  added: [y-partykit-unstable_getYDoc, partykit-alarms]
  patterns: [periodic-saves, disconnect-debounce, cold-start-loading, graceful-degradation]

key_files:
  modified:
    - partykit/server.ts

decisions:
  - context: "Periodic save interval"
    decision: "30 seconds for periodic saves while users are connected"
    rationale: "Balances data durability (protects against browser crashes) with Convex write load"

  - context: "Disconnect debounce window"
    decision: "7 seconds after last user disconnects before saving"
    rationale: "Within 5-10s user requirement, handles quick tab refresh without unnecessary saves"

  - context: "Cold-start loading architecture"
    decision: "Use y-partykit load callback to fetch from Convex GET /collaboration/snapshot endpoint"
    rationale: "Load callback is only invoked when Durable Object storage is empty (cold start), making Convex the fallback data source. PartyKit's Durable Object storage takes precedence when it exists."

  - context: "Save failure handling"
    decision: "Log errors but don't crash server or disconnect users"
    rationale: "PartyKit's Durable Object storage serves as fallback. Temporary save failures shouldn't break active collaboration sessions."

  - context: "Empty document detection"
    decision: "Skip save if Y.encodeStateAsUpdate returns empty buffer (length 0)"
    rationale: "Avoids creating unnecessary snapshot files for genuinely empty documents"

metrics:
  duration_seconds: 131
  duration_minutes: 2.2
  tasks_completed: 1
  files_modified: 1
  commits: 1
  completed_date: 2026-02-12
---

# Phase 15 Plan 02: PartyKit Snapshot Integration Summary

**One-liner:** Full Yjs snapshot persistence lifecycle in PartyKit: periodic saves every 30s, debounced save on last-user disconnect, and cold-start loading from Convex snapshots.

## What Was Built

### PartyKit Server Enhancement (partykit/server.ts)

**New Imports:**
- `unstable_getYDoc` from y-partykit - access to Yjs document state for encoding
- `YPartyKitOptions` type - shared options for onConnect and unstable_getYDoc
- `Y` from yjs - for encodeStateAsUpdate and applyUpdate operations

**Class-level State:**
- `saveAlarmScheduled` - tracks disconnect debounce alarm status
- `periodicAlarmScheduled` - tracks periodic save alarm status

**Constants:**
- `PERIODIC_SAVE_INTERVAL = 30_000` (30 seconds)
- `DISCONNECT_DEBOUNCE = 7_000` (7 seconds)
- `ALARM_TYPE_PERIODIC` and `ALARM_TYPE_DISCONNECT` - stored in room storage to track alarm purpose

**New Methods:**

**`getYjsOptions()` - Private method**
- Returns y-partykit configuration with `persist: { mode: "snapshot" }`
- Includes `load` callback for cold-start hydration from Convex
- Ensures consistent options between `onConnect` and `unstable_getYDoc` calls

**`loadSnapshotFromConvex()` - Private method**
- Fetches binary snapshot from Convex GET /collaboration/snapshot endpoint
- Returns null if no snapshot exists (404) or on error
- Handles missing environment variables gracefully
- Creates new Y.Doc and applies update from Convex snapshot
- Only called on cold-start when PartyKit Durable Object storage is empty

**`saveSnapshotToConvex()` - Private method**
- Gets current Yjs document state via `unstable_getYDoc`
- Encodes as binary update via `Y.encodeStateAsUpdate`
- Skips save if document is empty (update.length === 0)
- POSTs binary snapshot to Convex /collaboration/snapshot endpoint
- Authenticates via `PARTYKIT_SECRET` header
- Logs errors but doesn't throw (graceful degradation)

**Modified `onConnect()` method:**
- Uses `getYjsOptions()` instead of inline options object
- Schedules periodic save alarm after successful auth and connection
- Alarm scheduled with `PERIODIC_SAVE_INTERVAL` delay
- Sets `periodicAlarmScheduled = true` to prevent duplicate alarms

**New `onClose()` method:**
- Counts remaining connections after current connection closes
- If count reaches 0 (last user disconnected):
  - Schedules disconnect debounce alarm
  - Sets alarm type to `ALARM_TYPE_DISCONNECT` in room storage
  - Sets `saveAlarmScheduled = true`
  - Sets `periodicAlarmScheduled = false` (stops periodic saves)

**New `onAlarm()` method:**
Handles both periodic saves and disconnect debounce:

**Disconnect alarm (ALARM_TYPE_DISCONNECT):**
- Checks if anyone reconnected during debounce window
- If still no connections: saves final snapshot, clears `saveAlarmScheduled`
- If someone reconnected: cancels save, clears `saveAlarmScheduled`

**Periodic alarm (ALARM_TYPE_PERIODIC):**
- Checks if connections still exist
- If yes: saves snapshot, reschedules next periodic alarm
- If no: stops periodic saves (disconnect handler will take over)

### Persistence Flow

**Scenario 1: Active collaboration session**
- Users connect → periodic alarm scheduled
- Every 30 seconds: save snapshot to Convex, reschedule alarm
- Protects against browser crashes during long editing sessions

**Scenario 2: Last user disconnects**
- Last connection closes → onClose detects count = 0
- Debounce alarm scheduled for 7 seconds
- If user returns within 7s: alarm cancels, periodic saves resume
- If 7s passes with no reconnection: final snapshot saved

**Scenario 3: Cold-start (no active PartyKit state)**
- New user connects → onConnect calls y-partykit
- y-partykit invokes `load` callback (Durable Object storage empty)
- `loadSnapshotFromConvex` fetches from Convex GET endpoint
- Yjs document hydrated from snapshot
- Editing begins with full document state

### Error Resilience

**Missing environment variables:**
- Logs warning, returns null (for load) or exits early (for save)
- Doesn't crash server or disconnect users

**Convex fetch failures:**
- Caught and logged
- Save failures don't stop collaboration (Durable Object storage is fallback)
- Load failures result in empty document (user can start fresh)

**Empty document optimization:**
- Detects zero-length encoded state
- Skips unnecessary snapshot file creation
- Logs "skipping save: empty document"

## Deviations from Plan

None - plan executed exactly as written.

## Technical Implementation Details

### Alarm Management
- Room storage used to persist alarm type across potential server restarts
- In-memory flags (`saveAlarmScheduled`, `periodicAlarmScheduled`) for quick state checks
- Single setAlarm call per room at any time (either periodic or disconnect)

### Connection Counting
- Uses `this.room.getConnections()` iterable
- Manual count with for-loop (no array conversion needed)
- Accounts for the closing connection in onClose (counts remaining, not current)

### y-partykit Integration
- `load` callback only invoked on cold-start (when Durable Object storage empty)
- Must use same options object for `onConnect` and `unstable_getYDoc`
- `getYjsOptions()` method ensures consistency

### Binary Data Handling
- `Y.encodeStateAsUpdate` returns Uint8Array
- POST body uses `update.buffer` (ArrayBuffer) for fetch
- GET response uses `arrayBuffer()` then converts to Uint8Array

## Verification Results

All verification criteria passed:
- `npm run lint` - 0 warnings, 0 errors
- `npm run build` - successful compilation
- partykit/server.ts has all required imports (unstable_getYDoc, Y)
- All required methods implemented (getYjsOptions, loadSnapshotFromConvex, saveSnapshotToConvex, onClose, onAlarm)
- Constants within spec (DISCONNECT_DEBOUNCE in 5-10s range, PERIODIC_SAVE_INTERVAL = 30s)
- Existing auth flow preserved

## Integration Points

**Environment Variables Required (User Setup):**
- `PARTYKIT_SECRET` - shared secret for Convex API calls (must match Convex env)
- `CONVEX_SITE_URL` - Convex deployment URL (already configured from Phase 11)

**Convex Endpoints Used:**
- POST `/collaboration/snapshot?roomId={roomId}` - save snapshot
- GET `/collaboration/snapshot?roomId={roomId}` - load snapshot

**PartyKit Alarm System:**
- `room.storage.setAlarm(timestamp)` - schedule alarm
- `room.storage.put("alarmType", type)` - track alarm purpose
- `onAlarm()` - handles alarm execution

## Success Criteria Met

- [x] Periodic saves every 30 seconds while users connected
- [x] Debounced save on last-user disconnect (7 second window)
- [x] Cold-start loading from Convex snapshots
- [x] Quick tab refresh within debounce window doesn't trigger unnecessary save
- [x] Save failures logged but don't crash server or disconnect users
- [x] Existing auth flow preserved
- [x] All three resource types (documents, diagrams, tasks) covered (same server code)

## Task Commits

1. **Task 1: Implement periodic saves and disconnect debounce with alarm-based persistence** - `82263d6` (feat)

## User Setup Required

**External services require manual configuration.** The plan includes a `user_setup` section requiring:

**Environment Variables:**
- `PARTYKIT_SECRET` - Generate via `openssl rand -hex 32`, then set in both Convex and PartyKit

**Convex Configuration:**
```bash
npx convex env set PARTYKIT_SECRET <secret>
```

**PartyKit Configuration:**
- Set `PARTYKIT_SECRET` in partykit.json vars section or PartyKit dashboard
- Set `CONVEX_SITE_URL` if not already configured

## Next Phase Readiness

**Data durability complete:**
- Yjs state persists to Convex on both triggers (periodic + disconnect)
- Cold-starts hydrate from Convex snapshots
- All three collaborative resource types protected

**Known limitations (addressed in future phases):**
- Token consumed on connect (reconnection broken) - Phase 16
- No permission re-validation after connect - Phase 16
- No graceful degradation if Convex unavailable - Phase 17

**Phase 15 complete:**
- Snapshot persistence infrastructure built (15-01)
- PartyKit integration with full lifecycle management (15-02)
- Ready for authentication improvements in Phase 16

## Self-Check: PASSED

**Modified file verified:**
- partykit/server.ts exists and contains:
  - unstable_getYDoc import
  - Y.encodeStateAsUpdate and Y.applyUpdate usage
  - onClose method checking connection count
  - onAlarm method with periodic and disconnect alarm types
  - saveSnapshotToConvex POST to Convex endpoint
  - loadSnapshotFromConvex GET from Convex endpoint
  - getYjsOptions method with load callback
  - DISCONNECT_DEBOUNCE = 7000
  - PERIODIC_SAVE_INTERVAL = 30000

**Commit verified:**
- 82263d6 exists in git log

---
*Phase: 15-persistence-layer*
*Completed: 2026-02-12*
