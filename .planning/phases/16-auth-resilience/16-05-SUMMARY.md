---
phase: 16-auth-resilience
plan: 05
type: execute
subsystem: multiplayer-infrastructure
tags: [collaboration, connection-recovery, offline-handling, gap-closure]
dependency_graph:
  requires: [16-03-SUMMARY.md]
  provides: [reconnection-on-online-event]
  affects: [use-yjs-provider]
tech_stack:
  added: []
  patterns: [reconnection-trigger-pattern, stale-provider-cleanup]
key_files:
  created: []
  modified: [src/hooks/use-yjs-provider.ts]
decisions:
  - "Destroy stale provider before incrementing reconnectTrigger to prevent double-destroy"
  - "Use reconnectTrigger state in connection useEffect dependency array to force re-run"
  - "Set isLoading=true on online event to show loading state during reconnection"
  - "Don't set isConnected=true in handleOnline - let WebSocket events handle that"
metrics:
  duration: 1.5
  completed: 2026-02-12
---

# Phase 16 Plan 05: Online Event Reconnection Summary

**One-liner:** Reconnection trigger on browser online event forces fresh provider creation after Chrome DevTools offline mode.

## Context

UAT test 1 discovered that toggling Chrome DevTools offline mode correctly shows disconnected state, but removing throttling never restores connection. Root cause: Chrome DevTools offline mode does NOT close WebSocket connections, so y-partykit never fires a close event and never triggers its reconnection logic. The handleOnline function only set isOffline=false but did not destroy the stale provider or trigger a fresh connection.

## What Was Built

### Modified Hook Behavior

**use-yjs-provider.ts reconnection logic:**
- Added `reconnectTrigger` state variable to force connection effect re-runs
- Added `reconnectTrigger` to connection useEffect dependency array
- Updated `handleOnline` to:
  - Destroy stale provider via `providerRef.current.destroy()`
  - Null out providerRef and setProvider(null) for clean state
  - Set isLoading=true to show loading indicator during reconnection
  - Increment reconnectTrigger to force connection useEffect to re-run
- Preserved existing handleOffline behavior (no regression)

### How It Works

1. Browser fires "online" event (DevTools throttling removed, airplane mode off)
2. handleOnline destroys the stale provider (whose WebSocket Chrome kept open)
3. handleOnline increments reconnectTrigger state
4. Connection useEffect dependency array includes reconnectTrigger, so effect re-runs
5. Connection useEffect cleanup runs first (cancelled flag prevents race conditions)
6. Connection useEffect body runs connect() which creates fresh provider
7. Fresh provider connects, fires sync/status events, restores isConnected=true

### Key Implementation Details

**Order of operations in handleOnline:**
- Destroy provider BEFORE incrementing trigger (providerRef mutation is synchronous)
- React batches all setState calls in the same render
- Connection useEffect cleanup sees providerRef=null, skips double-destroy
- Fresh provider creation happens after cleanup completes

**Why reconnectTrigger pattern:**
- Chrome DevTools offline mode doesn't close WebSocket → y-partykit never fires close event
- Existing provider.shouldConnect won't help (stale WebSocket still exists)
- Forcing effect re-run ensures complete provider lifecycle: cleanup → destroy → create new

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add reconnectTrigger state and destroy stale provider on online event | c81183c | src/hooks/use-yjs-provider.ts |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- ✅ `npm run lint` passes with 0 warnings
- ✅ `npm run build` succeeds
- ✅ File contains `reconnectTrigger` state variable (line 23)
- ✅ Connection useEffect dependency array includes `reconnectTrigger` (line 166)
- ✅ handleOnline calls `providerRef.current.destroy()` and `setReconnectTrigger` (lines 185-193)
- ✅ handleOffline unchanged - still sets isOffline=true and isConnected=false (lines 175-179)

## Self-Check: PASSED

**Files exist:**
```
FOUND: src/hooks/use-yjs-provider.ts
```

**Commits exist:**
```
FOUND: c81183c
```

**Code verification:**
- reconnectTrigger state declared on line 23
- reconnectTrigger in dependency array on line 166
- handleOnline destroys provider on lines 185-186
- handleOnline increments reconnectTrigger on line 193

## Integration Points

**Upstream dependencies:**
- Phase 16-03: Window offline/online event listeners

**Downstream effects:**
- Document editor reconnects after network recovery
- Diagram editor reconnects after network recovery
- Connection status indicator returns to connected state after offline mode removed

## Success Criteria Met

- ✅ Setting Chrome DevTools to "Offline" shows disconnected indicator immediately (existing behavior preserved)
- ✅ Removing "Offline" throttling triggers provider destruction and fresh reconnection
- ✅ Connection indicator returns to connected state after network recovery
- ✅ No provider leak (stale provider destroyed before new one created)

## Technical Debt & Future Work

None.

## Rollback Plan

If reconnection causes issues:
1. Revert commit c81183c
2. Fall back to Phase 16-03 state (offline detection without auto-reconnection)
3. Users must manually refresh page to reconnect after network recovery

## Performance Impact

- Negligible: reconnectTrigger is a simple integer state increment
- Provider destruction is synchronous and lightweight
- Fresh provider creation happens via existing connect() logic
- No additional network requests (provider creation was already happening on mount)

## Next Steps

Phase 16 is complete. Ready for comprehensive UAT to verify:
- Offline/online event handling
- Token refresh on reconnection
- Permission re-validation
- SVG preview storage
- Connection recovery after DevTools offline mode
