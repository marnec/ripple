---
phase: 12-document-multiplayer-cursors-yjs-migration
plan: 02
subsystem: documents
tags: [yjs, awareness, cursors, presence, ui]
dependencies:
  requires:
    - 12-01-SUMMARY.md  # Yjs migration and user colors
  provides:
    - Cursor awareness UI with active users avatar stack
    - Connection status indicator (green/yellow/red)
    - Remote user presence via Yjs Awareness API
  affects:
    - DocumentEditor (removed old Convex presence, added Awareness-based UI)
    - All document collaborators see each other in avatar stack
tech-stack:
  added: []
  removed: []
  patterns:
    - Yjs Awareness API for real-time cursor tracking
    - Stale client filtering (10s timeout)
    - Idle cursor detection (30s inactivity)
    - Figma-style overlapping avatar stack
    - Connection status with sync indicators
key-files:
  created:
    - src/hooks/use-cursor-awareness.ts
    - src/pages/App/Document/ActiveUsers.tsx
    - src/pages/App/Document/ConnectionStatus.tsx
  modified:
    - src/pages/App/Document/DocumentEditor.tsx
  deleted: []
decisions:
  - title: "BlockNote handles cursor rendering automatically"
    rationale: "BlockNote collaboration mode (via y-prosemirror) renders colored carets and name labels built-in"
    impact: "No custom cursor overlay component needed — hook primarily for avatar stack data"
  - title: "10s stale client removal in avatar stack only"
    rationale: "Yjs Awareness default 30s timeout for in-editor cursors is acceptable — matches idle fade time"
    tradeoff: "Avatar stack more aggressive (10s) vs in-editor cursors (30s), but prevents ghost users in UI"
  - title: "Simple sync state heuristic (500ms after changes)"
    rationale: "Yjs syncs near-instantly over WebSocket — brief indicator sufficient"
    implementation: "Show syncing icon for 500ms after local yDoc updates"
  - title: "Removed old Convex presence system from DocumentEditor"
    rationale: "Yjs Awareness provides more accurate presence (directly from WebSocket connection)"
    impact: "FacePile and useEnhancedPresence no longer used in documents — cleaner architecture"
metrics:
  duration: 240
  completed: 2026-02-11T15:43:25Z
  tasks: 2
  files_changed: 5
  lines_added: 410
  lines_removed: 6
---

# Phase 12 Plan 02: Cursor Awareness UI and Active Users

**One-liner:** Real-time cursor awareness with Figma-style avatar stack, connection status indicators, and complete removal of old Convex presence from document editor.

## Summary

Added full cursor awareness UI to document collaboration using Yjs Awareness API. Active users are displayed as overlapping avatar stack with user-specific colors (from Plan 01). Connection status shows green/yellow/red indicator with sync state. Stale clients (unclean disconnects) filtered after 10s, idle cursors detected after 30s. BlockNote's built-in y-prosemirror integration automatically renders remote cursors as colored carets with name labels — no custom cursor component needed. Removed old Convex presence system (FacePile, useEnhancedPresence) from DocumentEditor.

## Tasks Completed

### Task 1: Cursor awareness hook and active users avatar stack
**Commit:** `c7b8341`
**Files:** `src/hooks/use-cursor-awareness.ts`, `src/pages/App/Document/ActiveUsers.tsx`

- Created `useCursorAwareness` hook:
  - Reads Yjs Awareness state from provider (`provider.awareness`)
  - Listens to `awareness.on('change', ...)` events for real-time updates
  - Returns `remoteUsers` array with cursor positions, colors, names
  - Filters stale clients (>10s since last update) via 1-second interval check
  - Tracks cursor position changes to detect idle state (>30s no movement)
  - Stores per-client timestamps and cursor positions in local state
  - Cleans up state on unmount or when awareness cleared

- Created `ActiveUsers` component:
  - Figma-style overlapping avatar stack (`flex -space-x-2`)
  - Current user displayed first (colored background, no border)
  - Remote users show colored border matching their user color
  - Avatar fallbacks display colored initials (user color background, white text)
  - Tooltips show user name and status (Editing/Viewing/Idle)
  - Idle users rendered with 50% opacity
  - Max 5 visible avatars, then "+N" overflow indicator
  - Uses shadcn/ui Tooltip and Avatar components

### Task 2: Connection status indicator and DocumentEditor integration
**Commit:** `aa09c78`
**Files:** `src/pages/App/Document/ConnectionStatus.tsx`, `src/pages/App/Document/DocumentEditor.tsx`

- Created `ConnectionStatus` component:
  - Three states with colored dots:
    - **Green**: Connected and synced
    - **Yellow with spinner**: Syncing changes (Loader2 icon + pulsing dot)
    - **Red**: Offline — changes saved locally (reassures user about IndexedDB)
  - Listens to provider events:
    - `provider.on('sync', ...)` for sync completion
    - `provider.on('status', ...)` for connection state
    - `yDoc.on('update', ...)` for local changes
  - Shows syncing indicator briefly (500ms) after local edits
  - Tooltips explain each state

- Updated `DocumentEditor.tsx`:
  - Removed imports: `FacePile`, `useEnhancedPresence`
  - Added imports: `useCursorAwareness`, `ActiveUsers`, `ConnectionStatus`, `getUserColor`
  - Hook returns `{ editor, isLoading, isConnected, provider }` — provider used for awareness
  - Added cursor awareness: `const { remoteUsers } = useCursorAwareness(provider?.awareness ?? null)`
  - Replaced FacePile with new header:
    ```tsx
    <div className="absolute top-5 right-10 z-10 flex items-center gap-3">
      <ConnectionStatus isConnected={isConnected} provider={provider} />
      <ActiveUsers remoteUsers={remoteUsers} currentUser={...} />
    </div>
    ```
  - Current user color generated via `getUserColor(viewer._id)` for consistency

## Deviations from Plan

None — plan executed exactly as written.

**Note on cursor rendering:** Plan anticipated potential need for custom CSS if BlockNote didn't render cursors automatically. Testing confirmed BlockNote's collaboration mode handles this via y-prosemirror's built-in cursor plugin — colored carets and name labels appear automatically. No additional CSS or cursor overlay component required.

## Verification Results

- ✓ `npm run lint` passes with zero warnings
- ✓ `npm run build` succeeds (24.0s)
- ✓ DocumentEditor shows ActiveUsers avatar stack in top-right header
- ✓ DocumentEditor shows ConnectionStatus indicator next to avatar stack
- ✓ useCursorAwareness reads from Yjs Awareness API
- ✓ No references to `FacePile` in Document directory
- ✓ No references to `useEnhancedPresence` in Document directory
- ✓ No references to `prosemirror-sync` anywhere in src/

## Technical Notes

### Cursor Awareness Architecture

**Data flow:**
1. BlockNote collaboration mode sets local user's awareness state automatically (name, color, cursor position)
2. Yjs Awareness broadcasts state changes to all connected clients via PartyKit WebSocket
3. `useCursorAwareness` hook subscribes to `awareness.on('change', ...)` events
4. Hook filters remote users (excludes local client ID) and stale clients (>10s)
5. `ActiveUsers` component renders avatar stack from `remoteUsers` array

**Staleness detection:**
```typescript
// Update timestamps on awareness change events
const handleAwarenessChange = ({ added, updated, removed }) => {
  [...added, ...updated].forEach(clientId => {
    newTimestamps.set(clientId, Date.now());
  });
};

// Filter stale clients in updateRemoteUsers (called every 1s)
if (now - lastUpdate > 10000) return; // Skip this client
```

**Idle detection:**
```typescript
// Track cursor position changes
if (cursor && cursorData) {
  const positionChanged =
    cursorData.position.anchor !== cursor.anchor ||
    cursorData.position.head !== cursor.head;

  if (!positionChanged && now - cursorData.timestamp > 30000) {
    isIdle = true; // 30s no cursor movement
  }
}
```

### Connection Status State Machine

| Condition | Dot Color | Icon | Tooltip |
|-----------|-----------|------|---------|
| `!isConnected` | Red | None | "Offline — changes saved locally" |
| `isConnected && isSyncing` | Yellow (pulsing) | Spinner | "Syncing changes..." |
| `isConnected && !isSyncing` | Green | None | "Connected" |

**Syncing triggers:**
- Initial connection: shows syncing until first `sync` event
- Reconnection: shows syncing for 500ms
- Local edits: shows syncing for 500ms after `yDoc.on('update')`

### BlockNote Cursor Rendering

BlockNote's `collaboration` option (from Plan 01) automatically enables y-prosemirror cursor rendering:

```typescript
collaboration: {
  provider,
  fragment: yDoc.getXmlFragment("document-store"),
  user: { name: userName, color: userColor },
}
```

This internally uses y-prosemirror's cursor plugin which:
- Renders colored carets at remote cursor positions (2px vertical line in user color)
- Shows floating name labels above carets (small pill with user name, colored background)
- Highlights text selections with translucent color overlays (user color at 30% opacity)
- Automatically removes cursors when clients disconnect (via Awareness cleanup)

**No custom CSS needed** — BlockNote includes default cursor styles.

## Impact Assessment

**Immediate:**
- Users can see who else is viewing/editing the document (avatar stack)
- Users can see each other's cursors and selections in real-time (BlockNote built-in)
- Connection status gives confidence that changes are syncing or cached offline
- Stale cursors cleaned up automatically (prevents ghost users after unclean disconnects)

**User Experience Improvements:**
- Figma-style avatar stack is familiar pattern (vs old generic FacePile)
- User colors are consistent with cursor colors (thanks to Plan 01 color system)
- Idle cursors fade after 30s (reduces visual clutter for AFK users)
- Offline indicator reassures users that IndexedDB is caching their work

**Architecture Simplification:**
- Single source of truth for presence: Yjs Awareness (replaces Convex presence queries)
- Fewer network requests (no polling for presence updates — WebSocket push only)
- Cleaner DocumentEditor code (removed old presence hooks)

## Edge Cases Handled

1. **Unclean disconnects:** 10s stale client filter removes users from avatar stack
2. **AFK users:** 30s idle detection fades their avatars to 50% opacity
3. **Offline editing:** Red connection status + tooltip explains local persistence
4. **Rapid reconnections:** 500ms debounce prevents flashing sync indicator
5. **No awareness (provider not ready):** Hook returns empty `remoteUsers` array

## Known Limitations

1. **Avatar stack vs in-editor cursor timeout mismatch:**
   - Avatar stack removes stale users after 10s (useCursorAwareness filtering)
   - In-editor cursors removed after 30s (Yjs Awareness default timeout)
   - **Tradeoff accepted:** 10s for avatar stack prevents UI confusion, 30s for cursors matches idle fade time

2. **No avatar images in Awareness state:**
   - Yjs Awareness only stores name + color (set by BlockNote collaboration)
   - ActiveUsers shows colored initials instead of profile pictures
   - **Future enhancement:** Could enrich Awareness data with Convex user queries if needed

3. **Idle fade applies to avatar stack only:**
   - In-editor cursors do NOT fade at 30s (BlockNote doesn't expose per-user idle state)
   - **Acceptable limitation:** Idle cursors eventually removed at 30s by Awareness timeout

## Self-Check: PASSED

**Created files exist:**
- ✓ src/hooks/use-cursor-awareness.ts
- ✓ src/pages/App/Document/ActiveUsers.tsx
- ✓ src/pages/App/Document/ConnectionStatus.tsx

**Modified files:**
- ✓ src/pages/App/Document/DocumentEditor.tsx (removed FacePile, added ActiveUsers + ConnectionStatus)

**Commits exist:**
- ✓ c7b8341 (Task 1: cursor awareness hook and avatar stack)
- ✓ aa09c78 (Task 2: connection status and integration)

**Integrations verified:**
- ✓ DocumentEditor imports and renders ActiveUsers
- ✓ DocumentEditor imports and renders ConnectionStatus
- ✓ useCursorAwareness receives `provider.awareness` from useDocumentCollaboration
- ✓ No references to old presence system remain

## Next Steps

1. **Plan 03 (if exists):** Additional cursor/presence polish or diagram multiplayer prep
2. **Phase 13:** Extend multiplayer to Excalidraw diagrams using y-excalidraw
3. **Future enhancements:**
   - Enrich Awareness state with avatar images from Convex
   - Add cursor fade animation in editor (if BlockNote exposes API)
   - Show typing indicators (e.g., "Alice is typing..." near cursor)

---

**Phase 12 Plan 02 Status:** ✅ Complete
**Duration:** 4.0 minutes
**Commits:** 2 (c7b8341, aa09c78)
