---
phase: 16-auth-resilience
plan: 03
subsystem: collaboration
tags: [gap-closure, offline-detection, ui-navigation]
dependency_graph:
  requires: [16-02-permission-revalidation]
  provides: [browser-offline-detection, diagram-block-navigation]
  affects: [connection-indicator, diagram-embeds]
tech_stack:
  added: []
  patterns: [window-event-listeners, navigator-online-check, react-router-navigation]
key_files:
  created: []
  modified:
    - src/hooks/use-yjs-provider.ts
    - src/pages/App/Document/CustomBlocks/DiagramBlock.tsx
decisions:
  - "Window offline/online events supplement WebSocket-based detection (both needed for full coverage)"
  - "navigator.onLine check at connect time prevents unnecessary connection attempts"
  - "Click navigation works regardless of editor editable state"
metrics:
  duration: 3.1 min
  completed: 2026-02-12
---

# Phase 16 Plan 03: UAT Gap Closure (Offline Detection + Diagram Navigation) Summary

**One-liner:** Added window offline/online event listeners to connection status and click-to-navigate handlers to diagram block embeds.

## What Was Built

This plan closed two UAT failures identified in 16-UAT:
1. Connection status indicator not responding to browser offline mode (UAT test 1)
2. Diagram block embeds not clickable despite placeholder text saying "Click to view" (UAT test 3)

### 1. Browser Offline Detection (Task 1)

**Problem:** useYjsProvider relied exclusively on WebSocket close events for connection status. Chrome DevTools offline mode does NOT close existing WebSockets (known Chrome limitation), so the connection indicator stayed green when the browser went offline.

**Solution:**
- Added separate useEffect listening for window "offline" and "online" events
- Window offline event immediately sets `isConnected=false` and `isOffline=true`
- Window online event sets `isOffline=false` (isConnected restored by WebSocket sync events)
- Added `navigator.onLine` check at connect time to skip connection attempts when already offline
- **Both detection mechanisms are needed:**
  - WebSocket close events catch server-side disconnects that don't trigger browser offline
  - Window offline events catch DevTools offline / airplane mode that don't close WebSockets

**Files Modified:**
- `src/hooks/use-yjs-provider.ts` - Added window event listeners and navigator.onLine check

### 2. Diagram Block Click Navigation (Task 2)

**Problem:** DiagramBlock placeholder showed "Click to view or edit this diagram" but had no click handler. Users expected navigation to work.

**Solution:**
- Added `useNavigate` and `useParams` from react-router-dom
- Created `handleClick` function: `navigate(\`/workspaces/${workspaceId}/diagrams/${diagramId}\`)`
- Added onClick handler, cursor-pointer, and hover:bg-muted/50 to placeholder div
- Matches DiagramEmbed.tsx navigation pattern (void navigate)
- Works regardless of editor editable state (resize handles don't conflict with inner div clicks)

**Files Modified:**
- `src/pages/App/Document/CustomBlocks/DiagramBlock.tsx` - Added click navigation to placeholder

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

All verifications passed:
- ✅ `npm run lint` passes with 0 warnings
- ✅ `npm run build` succeeds
- ✅ `src/hooks/use-yjs-provider.ts` contains window offline/online event listeners in a useEffect
- ✅ `src/pages/App/Document/CustomBlocks/DiagramBlock.tsx` contains useNavigate and onClick handler

## Key Decisions

**1. Dual detection mechanism (WebSocket + window events)**
- **Context:** Chrome DevTools offline mode doesn't close WebSockets, but server disconnects do
- **Decision:** Keep both WebSocket-based detection AND window offline/online events
- **Rationale:** Complementary coverage - neither mechanism catches all disconnect scenarios alone
- **Alternatives considered:** Remove WebSocket detection (rejected - would miss server-side disconnects)

**2. navigator.onLine check at connect time**
- **Context:** Browser might start in offline mode or go offline before provider creation
- **Decision:** Check `navigator.onLine` before attempting connection, skip if already offline
- **Rationale:** Prevents unnecessary connection attempts and avoids timeout delay
- **Implementation:** Early return in connect function sets isOffline=true, isLoading=false

**3. Navigation works regardless of editor state**
- **Context:** Editor might be read-only but users still want to view diagrams
- **Decision:** No editable check - always allow navigation on click
- **Rationale:** Viewing a diagram is a read operation, doesn't require edit permissions
- **Note:** Resize handles use mousedown/mousemove/mouseup and don't conflict with onClick

## Self-Check

**Files Created:** None

**Files Modified:**
```bash
[ -f "src/hooks/use-yjs-provider.ts" ] && echo "FOUND: src/hooks/use-yjs-provider.ts" || echo "MISSING: src/hooks/use-yjs-provider.ts"
[ -f "src/pages/App/Document/CustomBlocks/DiagramBlock.tsx" ] && echo "FOUND: src/pages/App/Document/CustomBlocks/DiagramBlock.tsx" || echo "MISSING: src/pages/App/Document/CustomBlocks/DiagramBlock.tsx"
```

**Commits:**
```bash
git log --oneline --all | grep -q "7fec5d0" && echo "FOUND: 7fec5d0" || echo "MISSING: 7fec5d0"
git log --oneline --all | grep -q "692f915" && echo "FOUND: 692f915" || echo "MISSING: 692f915"
```

**Self-Check Results:**

=== File Check ===
FOUND: src/hooks/use-yjs-provider.ts
FOUND: src/pages/App/Document/CustomBlocks/DiagramBlock.tsx

=== Commit Check ===
FOUND: 7fec5d0
FOUND: 692f915

## Self-Check: PASSED
