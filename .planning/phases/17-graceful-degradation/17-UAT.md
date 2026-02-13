---
status: issues-found
phase: 17-graceful-degradation
source: 17-01-SUMMARY.md, 17-02-SUMMARY.md
started: 2026-02-13T12:00:00Z
updated: 2026-02-13T12:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

testing: complete
result: 8 passed, 2 issues (both caused by GAP-1)

## Tests

### 1. Connection Status — Online
expected: Open any document or diagram. A small green dot should appear in the collaboration UI area. Hovering it should show a "Connected" tooltip.
result: pass

### 2. ActiveUsers Visible When Online
expected: Open a document (or diagram or task) while connected. The ActiveUsers avatar stack should be visible showing your avatar.
result: pass

### 3. Connection Status — Offline
expected: Stop PartyKit (or disconnect network), then open a document you've previously visited. The ConnectionStatus should show a cloud-off icon with "Offline — changes saved locally" tooltip instead of the green dot.
result: pass

### 4. Document Offline Editing (Cached)
expected: With PartyKit stopped, open a document you've recently edited (so IndexedDB has cached data). After ~4 seconds, the editor should load with your cached content and be fully editable (not read-only). No crash or blank screen.
result: pass

### 5. ActiveUsers Hidden When Offline
expected: While offline with a document/diagram open, the ActiveUsers avatar stack should NOT appear. Only the ConnectionStatus (cloud-off icon) should be visible.
result: pass

### 6. Document Cold-Start Snapshot Fallback
expected: Clear browser data (or use incognito) and stop PartyKit, then open a document that has a Convex snapshot. After timeout, a read-only version should appear showing the document content (not editable). This is the "Viewing saved version" mode.
result: issue — Snapshots never saved. The onAlarm handler crashes because `this.room.id` (Party.id) is inaccessible in PartyKit alarm context. Every periodic save and disconnect-debounce save fails, so no snapshots ever reach Convex. The cold-start fallback has nothing to load.

### 7. Diagram Offline (Cached)
expected: With PartyKit stopped, open a diagram you've previously visited. After ~4 seconds, the diagram should load from IndexedDB cache and be viewable. The cloud-off icon should appear.
result: pass — Content loads offline from IndexedDB. Note: clearing IDB from DevTools while page is open doesn't take effect (Chrome defers deletion when connections are active).

### 8. Diagram Cold-Start Snapshot Fallback
expected: Clear browser data and stop PartyKit, then open a diagram with a Convex snapshot. After timeout, the diagram should render in read-only mode (viewModeEnabled) with a "Viewing saved version (offline)" label.
result: issue — Blocked by GAP-1: no Convex snapshots available because onAlarm save never succeeds.

### 9. Task Description Offline
expected: With PartyKit stopped, open a task that has a description you've previously edited. After ~4 seconds, the task description should load from IndexedDB cache. ActiveUsers should be hidden; ConnectionStatus should show offline.
result: pass — Minor: orphan "task-" IDB database created when TaskDetailSheet renders with null taskId (see GAP-2).

### 10. Auto-Recovery on Reconnection
expected: While in offline mode (cloud-off icon visible), restart PartyKit (or restore network). The editor should automatically reconnect — green dot returns, ActiveUsers reappear, and the editor transitions to live collaborative mode without a page refresh.
result: pass

## Summary

total: 10
passed: 8
issues: 2
pending: 0
skipped: 0

## Gaps

### GAP-1: PartyKit onAlarm cannot access Party.id — snapshots never saved
- **Root cause**: `this.room.id` is used in `onAlarm()` (server.ts:301,306,319,328) and all methods it calls (`saveSnapshotToConvex`, `checkPermissions`), but PartyKit prohibits `Party.id` access in alarm handlers (known platform limitation)
- **Impact**: Every periodic save (30s) and disconnect-debounce save (7s) crashes. No snapshots are ever written to Convex. Cold-start fallback (Test 6), and likely diagram cold-start (Test 8) are broken.
- **Fix**: Store `this.room.id` in `this.room.storage` during `onConnect` (where it IS accessible). In `onAlarm`, read the cached roomId from storage and pass it to helper methods instead of accessing `this.room.id` directly.
- **Files**: `partykit/server.ts` — `onAlarm`, `saveSnapshotToConvex`, `checkPermissions`, `onConnect`

### GAP-2: Orphan "task-" IndexedDB database (cosmetic)
- **Root cause**: `useTaskDetail.ts:34` passes `documentId: taskId ?? ""` when taskId is null. `useDocumentCollaboration` creates `IndexeddbPersistence("task-", yDoc)` unconditionally — it doesn't check the `enabled` flag.
- **Impact**: Cosmetic — a stale empty "task-" database in IndexedDB. No functional harm.
- **Fix**: Gate the IndexedDB persistence effect on `enabled && documentId` in `use-document-collaboration.ts`.
- **Files**: `src/hooks/use-document-collaboration.ts` (line 56-57)

### GAP-3: Reconnection auth storm after long disconnect (observation)
- **Root cause**: After a long disconnect, restarting PartyKit triggers a rapid reconnection loop. Each attempt calls `params()` → `getCollaborationToken` → connects → `onConnect` verifies with Convex → 401 Unauthorized. The provider recreation logic (MAX_UNSUCCESSFUL_RECONNECTS=5 → destroy → recreate) creates an infinite cycle of failing reconnections. The workerd "Network connection lost" crashes are a PartyKit platform issue triggered by abrupt WebSocket closure during auth processing.
- **Impact**: Noisy server-side error storm. Self-healing (eventually reconnects — Test 10 passed). No data loss. The workerd crashes are cosmetic but concerning in logs.
- **Fix**: Add exponential backoff or max recreation limit to provider recreation loop in `use-yjs-provider.ts`. Consider: if auth fails N times in a row, pause reconnection and show a "reconnecting..." UI rather than hammering the server.
- **Files**: `src/hooks/use-yjs-provider.ts` (reconnectCheckRef interval, MAX_UNSUCCESSFUL_RECONNECTS logic)
- **Recommendation**: Handle as `/gsd:quick` task — resilience improvement, not blocking
