---
phase: 17-graceful-degradation
plan: 01
subsystem: collaboration-offline-fallback
tags:
  - offline-mode
  - indexeddb
  - connection-timeout
  - graceful-degradation
  - convex-snapshots
  - connection-ui
dependency_graph:
  requires:
    - "15-01: Periodic snapshot saves to Convex"
    - "16-01: Dynamic token refresh via async params"
  provides:
    - "Timeout-based PartyKit connection fallback (4s)"
    - "IndexedDB-first loading decoupled from provider"
    - "Public snapshot URL query with auth"
    - "Two-state connection indicator UI"
  affects:
    - "17-02: Will build on offline detection for read-only fallback"
tech_stack:
  added:
    - "CONNECTION_TIMEOUT constant for offline detection"
    - "IndexeddbPersistence independent initialization"
    - "convex/snapshots.getSnapshotUrl public query"
  patterns:
    - "Timeout-based degradation (4s user decision threshold)"
    - "Dual-source loading: provider OR IndexedDB"
    - "Non-blocking provider: continues reconnection after timeout"
    - "Ref-based connection tracking to avoid exhaustive-deps warnings"
key_files:
  created: []
  modified:
    - "src/hooks/use-yjs-provider.ts: Added CONNECTION_TIMEOUT, isOffline state, timeout-based fallback"
    - "src/hooks/use-document-collaboration.ts: Decoupled IndexedDB from provider, dual-source loading"
    - "src/hooks/use-diagram-collaboration.ts: Decoupled IndexedDB from provider, dual-source loading"
    - "convex/snapshots.ts: Added getSnapshotUrl public query with auth check"
    - "src/pages/App/Document/ConnectionStatus.tsx: Simplified to two-state indicator"
    - "src/pages/App/Diagram/DiagramPage.tsx: Updated ConnectionStatus props"
    - "src/pages/App/Document/DocumentEditor.tsx: Updated ConnectionStatus props"
    - "src/pages/App/Project/TaskDetailPage.tsx: Updated ConnectionStatus props"
    - "src/pages/App/Project/TaskDetailSheet.tsx: Updated ConnectionStatus props"
decisions:
  - decision: "4-second connection timeout (CONNECTION_TIMEOUT = 4000)"
    rationale: "Within 3-5s user decision threshold from research; allows graceful degradation without excessive wait"
    alternatives: ["3s (too aggressive)", "5s (acceptable but slower UX)"]
  - decision: "Decouple IndexedDB initialization from provider lifecycle"
    rationale: "IndexedDB only needs Y.Doc, not provider; enables offline-first loading pattern"
    alternatives: ["Keep coupled (blocks offline loading)", "Wait for both (slower cold-start)"]
  - decision: "Loading completes when EITHER provider syncs OR IndexedDB syncs"
    rationale: "Fastest-source-wins pattern for optimal perceived performance"
    alternatives: ["Wait for both (slower)", "Provider-only (no offline support)"]
  - decision: "Provider continues reconnecting after timeout"
    rationale: "Non-blocking degradation: timeout only gates UI, not connection attempt"
    alternatives: ["Cancel provider (no reconnection)", "Retry with exponential backoff (complex)"]
  - decision: "Two-state ConnectionStatus: connected (green dot) vs offline (cloud-off icon)"
    rationale: "User research showed syncing state adds confusion; binary state clearer"
    alternatives: ["Three-state (connected/syncing/offline)", "Text labels instead of icons"]
  - decision: "Use ref-based connection tracking (isConnectedRef)"
    rationale: "Avoids React exhaustive-deps warning when timeout reads isConnected"
    alternatives: ["Suppress lint warning (bad practice)", "Restructure useEffect deps (more complex)"]
metrics:
  duration: 329
  completed_date: 2026-02-12
---

# Phase 17 Plan 01: Offline Infrastructure Foundation Summary

**One-liner:** IndexedDB-first loading with 4-second timeout fallback, public snapshot URL query, and simplified two-state connection indicator.

## What Was Built

Built the core offline infrastructure enabling editors to remain functional when PartyKit is unavailable:

1. **Timeout-based connection fallback** in `useYjsProvider`:
   - 4-second `CONNECTION_TIMEOUT` constant (within 3-5s user decision threshold)
   - `isOffline` state tracking when connection attempt times out
   - Provider continues reconnecting in background after timeout (non-blocking degradation)
   - Ref-based connection tracking to avoid React exhaustive-deps warnings

2. **Decoupled IndexedDB initialization** in collaboration hooks:
   - Removed `if (!provider) return` guard in both `useDocumentCollaboration` and `useDiagramCollaboration`
   - IndexedDB persistence now initializes based on `yDoc` and `resourceId` alone, independent of provider
   - Changed loading logic: `isLoading = providerLoading && !indexedDbSynced` (fastest-source-wins)
   - Editor renders when either provider OR IndexedDB has data: `editor: (provider || indexedDbSynced) ? editor : null`

3. **Public snapshot URL query** in `convex/snapshots.ts`:
   - Added `getSnapshotUrl` public query with authentication check
   - Returns download URL for Yjs snapshot stored in Convex file storage
   - Enables cold-start fallback when IndexedDB is empty and PartyKit is unreachable

4. **Simplified ConnectionStatus component**:
   - Reduced from three states (connected/syncing/disconnected) to two (connected/offline)
   - Connected: small green dot with "Connected" tooltip
   - Offline: cloud-off icon with "Offline — changes saved locally" tooltip
   - Removed provider-based event listeners — state fully driven by `isConnected` prop
   - Updated all call sites to remove provider prop

## Architecture

### Dual-Source Loading Pattern

```
Editor Mount
     |
     ├─> IndexedDB starts syncing (immediate, no provider needed)
     |
     ├─> Provider starts connecting (async, 4s timeout)
     |
     └─> Loading completes when EITHER syncs first
             |
             ├─> IndexedDB syncs first → offline mode (editor works from cache)
             |
             └─> Provider syncs first → online mode (normal collaboration)
```

### Timeout Behavior

```
Provider Connection Attempt
     |
     ├─> Connected within 4s → clearTimeout, set isOffline=false, isLoading=false
     |
     └─> Timeout fires (4s) → set isOffline=true, isLoading=false
             |
             └─> Provider continues attempting connection in background
                     |
                     └─> If later succeeds → set isOffline=false, sync with IndexedDB
```

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

All verification criteria passed:

- [x] `npm run lint` passes with 0 warnings
- [x] `npm run build` compiles successfully
- [x] useYjsProvider returns `isOffline` boolean that becomes true after 4s timeout
- [x] IndexedDB persistence in both collaboration hooks initializes independently of provider
- [x] Loading state resolves when either provider OR IndexedDB syncs
- [x] Editor is available when either provider or IndexedDB has data (not blocked on provider)
- [x] convex/snapshots.ts has public getSnapshotUrl query with auth check
- [x] ConnectionStatus shows two-state indicator (green dot / cloud-off icon)

## Integration Points

### For Phase 17-02 (Read-Only Fallback):

- `isOffline` boolean from `useYjsProvider` indicates when PartyKit is unreachable
- `getSnapshotUrl` query fetches Convex snapshot for cold-start fallback
- ConnectionStatus already simplified to two states (won't need changes)

### For Future Enhancements:

- IndexedDB staleness check (currently skipped per plan): if needed later, can add 7-day expiration logic
- Network status API integration: could supplement timeout with navigator.onLine
- Progressive loading: could show partial content from IndexedDB while waiting for provider

## Self-Check: PASSED

**Commit verification:**
```bash
git log --oneline -2
# e9b1450 feat(17-01): add public snapshot URL query and redesign ConnectionStatus
# d3b3185 feat(17-01): decouple IndexedDB from provider and add timeout-based fallback
```

**File existence checks:**
- [x] src/hooks/use-yjs-provider.ts contains CONNECTION_TIMEOUT and isOffline
- [x] src/hooks/use-document-collaboration.ts has decoupled IndexedDB initialization
- [x] src/hooks/use-diagram-collaboration.ts has decoupled IndexedDB initialization
- [x] convex/snapshots.ts exports getSnapshotUrl public query
- [x] src/pages/App/Document/ConnectionStatus.tsx uses CloudOff icon

All commits exist in git history. All modified files verified.

## Next Steps

Proceed to Phase 17 Plan 02: implement read-only fallback mode when both IndexedDB and PartyKit are unavailable (cold-start with Convex snapshot).
