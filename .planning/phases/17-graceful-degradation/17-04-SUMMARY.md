---
phase: 17-graceful-degradation
plan: 04
subsystem: offline-collaboration
tags: [gap-closure, edge-cases, resilience, rate-limiting]
dependency_graph:
  requires:
    - "17-01 (connection timeout and IndexedDB)"
    - "17-03 (roomId caching for alarm handlers)"
  provides:
    - "Guarded IndexedDB persistence"
    - "Rate-limited provider reconnection"
  affects:
    - "src/hooks/use-document-collaboration.ts"
    - "src/hooks/use-yjs-provider.ts"
tech_stack:
  added: []
  patterns:
    - "Early return guards for conditional initialization"
    - "Exponential backoff for retry logic"
    - "Max attempt counters to prevent infinite loops"
    - "State reset on successful recovery"
key_files:
  created: []
  modified:
    - path: "src/hooks/use-document-collaboration.ts"
      summary: "Added enabled && documentId guard to IndexedDB persistence"
    - path: "src/hooks/use-yjs-provider.ts"
      summary: "Added exponential backoff and max recreation limit"
    - path: "partykit/server.ts"
      summary: "Fixed TypeScript type assertions for storage.get calls"
decisions:
  - "IndexedDB persistence only initializes when enabled=true AND documentId is non-empty"
  - "Provider recreation limited to 3 attempts with exponential backoff (2s, 4s, 8s)"
  - "Recreation counter resets on successful sync or browser online event"
  - "After max recreations, system shows offline mode instead of cycling infinitely"
metrics:
  duration: 388s
  tasks_completed: 2
  files_modified: 3
  commits: 2
  completed: 2026-02-13
---

# Phase 17 Plan 04: IndexedDB Guards and Reconnection Rate Limiting Summary

**One-liner:** Prevented orphan IndexedDB databases and infinite auth storms via guarded persistence and exponential backoff on provider recreation.

## Objective

Fix two minor issues found in UAT:
1. **GAP-2 (cosmetic):** Orphan "task-" IndexedDB database created when taskId is null
2. **GAP-3 (resilience):** Reconnection auth storm with infinite provider recreation loop

## Tasks Completed

### Task 1: Gate IndexedDB Persistence
**Files:** `src/hooks/use-document-collaboration.ts`
**Commit:** b57ffb2

Added early return guard to IndexedDB persistence useEffect:
```typescript
if (!enabled || !documentId) {
  return;
}
```

This prevents creating IndexedDB databases when:
- Hook is disabled (`enabled=false`)
- DocumentId is empty string (e.g., `taskId ?? ""` when taskId is null)

Also added `enabled` to the dependency array for proper cleanup.

**Result:** No more orphan "task-" database in IndexedDB when TaskDetailSheet renders with null taskId.

### Task 2: Add Exponential Backoff and Max Recreation Limit
**Files:** `src/hooks/use-yjs-provider.ts`, `partykit/server.ts`
**Commit:** 7fc37aa

Implemented rate limiting for provider recreation to prevent infinite auth storms:

**Constants added:**
- `MAX_RECREATIONS = 3` - Stop after 3 recreation attempts
- `BASE_RECREATION_DELAY = 2000` - 2s base for exponential backoff (2s, 4s, 8s)

**Implementation:**
- Added `recreationCountRef` to track recreation attempts
- Modified reconnect check interval to use exponential backoff via `setTimeout`
- Stop recreating and show offline mode after 3 attempts
- Reset counter on successful sync (connection recovered)
- Reset counter on browser online event (user-initiated recovery)

**Example flow:**
1. Provider fails 5 reconnect attempts → destroy and schedule recreation
2. Attempt 1: Wait 2s, recreate
3. Attempt 2: Wait 4s, recreate
4. Attempt 3: Wait 8s, recreate
5. After attempt 3: Stop, set offline mode, no more auth requests

**Result:** Reconnection loop has exponential backoff instead of fixed-interval hammering. After repeated auth failures, reconnection pauses instead of cycling infinitely.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type assertions in PartyKit server**
- **Found during:** Task 2 verification (npm run lint)
- **Issue:** ESLint errors on unnecessary type assertions in `partykit/server.ts`. The assertions `as string | undefined` on `storage.get("roomId")` were redundant since TypeScript already inferred that type, but removing them caused template literal errors because the inferred type was too generic (`{}`).
- **Fix:** Changed approach to assert type after null check instead of at call site. Used `roomIdRaw` variable, checked for null, then asserted to `string`. For the disconnect handler (line 281), used inline assertion `(roomId as string) ?? "unknown"` since it's used in a template literal with nullish coalescing.
- **Files modified:** `partykit/server.ts` (lines 281, 294-301)
- **Commit:** 7fc37aa (included in Task 2 commit)

## Verification

All verification criteria passed:

- ✅ `npm run lint` passes with 0 warnings
- ✅ `npm run build` compiles successfully
- ✅ IndexedDB persistence gated on `enabled && documentId`
- ✅ `MAX_RECREATIONS` constant and guard condition present
- ✅ `recreationCountRef` declared, incremented, and reset appropriately
- ✅ Provider recreation uses `setTimeout` with exponential delay
- ✅ Recreation counter resets on sync success and browser online event

## Key Insights

1. **Guard placement matters:** The IndexedDB guard needed to be at the top of the useEffect, not just gating the constructor call, because the cleanup function also shouldn't run if nothing was initialized.

2. **State reset is critical:** Without resetting `recreationCountRef` on successful connection or browser online events, users would hit the max limit permanently after one long disconnect, even if connectivity is restored.

3. **Type assertions and TypeScript inference:** The PartyKit storage API returns a generic type that needs explicit assertion. The original code used assertions at the call site, but TypeScript/ESLint now prefers assertions after null checks where the value is actually used.

4. **Exponential backoff prevents server load:** The old fixed 2s interval between provider recreations could hammer the auth endpoint. Exponential backoff (2s, 4s, 8s) gives the server breathing room and aligns with standard retry patterns.

## Must-Haves Achieved

### Truths
- ✅ No orphan 'task-' IndexedDB database created when taskId is null
- ✅ Reconnection loop has exponential backoff instead of fixed-interval hammering
- ✅ After repeated auth failures, reconnection pauses instead of cycling infinitely

### Artifacts
- ✅ `src/hooks/use-document-collaboration.ts` - IndexedDB persistence gated on `enabled && documentId`
- ✅ `src/hooks/use-yjs-provider.ts` - Exponential backoff on provider recreation, max recreation limit

### Key Links
- ✅ IndexedDB effect early returns when disabled or no documentId
- ✅ Reconnection check uses `recreationCountRef` and `MAX_RECREATIONS` for rate limiting

## Files Modified

1. **src/hooks/use-document-collaboration.ts**
   - Added guard: `if (!enabled || !documentId) return;`
   - Added `enabled` to dependency array

2. **src/hooks/use-yjs-provider.ts**
   - Added `MAX_RECREATIONS` and `BASE_RECREATION_DELAY` constants
   - Added `recreationCountRef` state
   - Modified reconnection check to use exponential backoff
   - Added max recreation guard
   - Reset counter on sync success and browser online event

3. **partykit/server.ts**
   - Fixed type assertions for `storage.get("roomId")` calls

## Impact

**User Experience:**
- No more confusing orphan "task-" database in browser DevTools
- After long disconnects (e.g., laptop sleep), auth requests don't hammer the server
- Users see offline mode after 3 reconnection attempts instead of infinite loading

**System Resilience:**
- Server protected from auth storms when provider repeatedly fails to connect
- Exponential backoff reduces load during connectivity issues
- Clear terminal state (offline mode) after max attempts instead of ambiguous cycling

**Production Readiness:**
- Edge cases in offline collaboration system cleaned up
- GAP-2 and GAP-3 from UAT resolved
- Ready for Phase 17 UAT completion

## Self-Check: PASSED

**Created files:** None (gap closure plan)

**Modified files:**
- ✅ FOUND: src/hooks/use-document-collaboration.ts
- ✅ FOUND: src/hooks/use-yjs-provider.ts
- ✅ FOUND: partykit/server.ts

**Commits:**
- ✅ FOUND: b57ffb2 (Task 1 - IndexedDB guard)
- ✅ FOUND: 7fc37aa (Task 2 - Exponential backoff and PartyKit fix)
