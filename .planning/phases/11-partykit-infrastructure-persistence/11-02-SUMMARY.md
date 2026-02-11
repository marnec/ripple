---
phase: 11-partykit-infrastructure-persistence
plan: 02
subsystem: infrastructure
tags: [partykit, yjs, authentication, convex, cleanup]
dependency-graph:
  requires:
    - 11-01-partykit-server
  provides:
    - authenticated-partykit-connections
    - frontend-yjs-provider-hook
  affects:
    - document-editor
    - diagram-editor
tech-stack:
  added: []
  patterns:
    - One-time token authentication for WebSocket connections
    - Convex HTTP endpoint for PartyKit auth verification
    - React hook pattern for Yjs provider lifecycle management
key-files:
  created:
    - convex/collaboration.ts: Token generation and validation for PartyKit auth
    - src/hooks/use-yjs-provider.ts: React hook for authenticated Yjs provider connections
  modified:
    - convex/schema.ts: Added collaborationTokens table, removed cursorSessions table
    - convex/http.ts: Added /collaboration/verify endpoint
    - partykit/server.ts: Added auth gate in onConnect handler
    - src/pages/App/Document/DocumentEditor.tsx: Removed RTK cursor tracking
  deleted:
    - convex/cursorSessions.ts: Legacy RTK cursor session tracking
    - src/hooks/use-cursor-tracking.ts: Legacy RTK cursor tracking hook
    - src/pages/App/Document/CursorOverlay.tsx: Legacy RTK cursor overlay component
decisions:
  - desc: Use one-time token authentication instead of JWT
    rationale: Simpler implementation using Convex's built-in auth, tokens stored in collaborationTokens table with 5-minute expiration
  - desc: Auth verification in PartyKit onConnect handler
    rationale: y-partykit uses onConnect function pattern (not class methods), auth check happens before delegating to y-partykit handler
  - desc: Complete removal of RTK cursor tracking system
    rationale: Phase 12 will implement Yjs Awareness-based cursors, RTK cursor code is now obsolete
metrics:
  tasks: 2
  commits: 2
  files-created: 2
  files-modified: 5
  files-deleted: 3
  duration: 5.7 min
  completed: 2026-02-11T12:48:57Z
---

# Phase 11 Plan 02: PartyKit Authentication & Frontend Integration Summary

Authenticated PartyKit connections with Convex token passthrough and frontend Yjs provider hook. Legacy RTK cursor tracking system removed.

## Execution Report

### Tasks Completed

| Task | Name                                                | Status   | Commit  |
| ---- | --------------------------------------------------- | -------- | ------- |
| 1    | Convex auth endpoint and PartyKit onBeforeConnect   | Complete | 4acc493 |
| 2    | Frontend useYjsProvider hook and RTK cursor cleanup | Complete | 576194d |

### What Was Built

**Authentication Flow**
- Frontend calls `api.collaboration.getCollaborationToken` (Convex action)
- Action verifies user has document/diagram access via documentMembers/diagramMembers indexes
- Action generates random UUID token with 5-minute expiration, stores in collaborationTokens table
- Frontend passes token as query param when connecting to PartyKit WebSocket
- PartyKit calls Convex HTTP endpoint `/collaboration/verify` to validate token
- Endpoint consumes (validates + deletes) one-time token, returns user info
- PartyKit allows connection if token valid, rejects with 401/403 if invalid

**Frontend Integration**
- `useYjsProvider` hook manages full lifecycle: token acquisition, PartyKit connection, Yjs sync, cleanup
- Hook accepts `resourceType` ("doc" | "diagram"), `resourceId`, and `enabled` flag
- Returns `{ yDoc, provider, isConnected, isLoading }` for consumer components
- Proper cleanup on unmount: destroys provider and Y.Doc to prevent memory leaks

**RTK Cursor Cleanup**
- Deleted `cursorSessions` table from schema (removed index)
- Deleted `convex/cursorSessions.ts` (all cursor session queries/mutations)
- Deleted `src/hooks/use-cursor-tracking.ts` (RTK cursor tracking hook)
- Deleted `src/pages/App/Document/CursorOverlay.tsx` (RTK cursor overlay component)
- Updated `DocumentEditor.tsx`: removed cursor tracking imports and usage
- Phase 12 will implement Yjs Awareness-based cursors to replace this functionality

### Implementation Details

**collaborationTokens Table** (convex/schema.ts)
```typescript
collaborationTokens: defineTable({
  token: v.string(),        // Random UUID
  userId: v.id("users"),    // Token owner
  roomId: v.string(),       // "doc-{id}" or "diagram-{id}"
  expiresAt: v.number(),    // Timestamp ms (5 min TTL)
})
  .index("by_token", ["token"]),
```

**Token Generation** (convex/collaboration.ts)
- `getCollaborationToken` action: Verifies auth + access, generates UUID, stores token, returns `{ token, roomId }`
- `checkDocumentAccess` internal query: Uses `documentMembers.by_document_user` index
- `checkDiagramAccess` internal query: Uses `diagramMembers.by_diagram_user` index
- `storeToken` internal mutation: Inserts token into collaborationTokens table
- `consumeToken` internal mutation: Validates token (not expired), deletes it (one-time use), returns userId + roomId
- `getUserInfo` internal query: Returns user name for logging

**HTTP Endpoint** (convex/http.ts)
```typescript
POST /collaboration/verify
Headers: Authorization: Bearer <token>
Body: { roomId: string }
Response: { userId: string, userName: string }
Error codes: 401 (invalid/expired token), 403 (room mismatch), 400 (missing roomId)
```

**PartyKit Auth Gate** (partykit/server.ts)
```typescript
async onConnect(conn, ctx) {
  // Extract token from URL query params
  const token = new URL(ctx.request.url).searchParams.get("token");
  if (!token) { conn.close(1008, "Missing auth token"); return; }

  // Verify with Convex
  const response = await fetch(`${CONVEX_SITE_URL}/collaboration/verify`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, ... },
    body: JSON.stringify({ roomId: this.room.id }),
  });

  if (!response.ok) { conn.close(1008, "Unauthorized"); return; }

  // Delegate to y-partykit
  return onConnect(conn, this.room, { persist: { mode: "snapshot" } });
}
```

**useYjsProvider Hook** (src/hooks/use-yjs-provider.ts)
```typescript
export function useYjsProvider(opts: {
  resourceType: "doc" | "diagram";
  resourceId: string;
  enabled?: boolean;
}) {
  const getToken = useAction(api.collaboration.getCollaborationToken);
  const [provider, setProvider] = useState<YPartyKitProvider | null>(null);
  const yDoc = useMemo(() => new Y.Doc(), []);

  useEffect(() => {
    // Get token from Convex
    const { token, roomId } = await getToken({ resourceType, resourceId });

    // Connect to PartyKit with token
    const newProvider = new YPartyKitProvider(host, roomId, yDoc, {
      connect: true,
      params: { token }, // Token passed as query param
    });

    // Cleanup on unmount
    return () => { provider?.destroy(); };
  }, [resourceType, resourceId, enabled]);

  return { yDoc, provider, isConnected, isLoading };
}
```

### Environment Variables

**Required in `.env.local`** (not committed to git):
```bash
# PartyKit needs this to call Convex HTTP endpoint
CONVEX_SITE_URL=https://dutiful-pika-875.convex.site

# Frontend needs this to connect to PartyKit
VITE_PARTYKIT_HOST=localhost:1999
```

For production, these will be set via deployment configuration (Netlify env vars for frontend, PartyKit vars for backend).

### Deviations from Plan

None - plan executed exactly as written. The plan correctly anticipated the `onConnect` function pattern from 11-01 and designed auth around it.

### Verification Results

All verification criteria passed:

- [x] `npm run lint` passes with zero warnings
- [x] `npm run build` succeeds
- [x] Schema deployed with collaborationTokens table, without cursorSessions table
- [x] No references to use-cursor-tracking, CursorOverlay, or cursorSessions in src/ or convex/ (excluding _generated)
- [x] useYjsProvider hook available for Phase 12/13 consumption

### Files Modified

**Backend (Convex)**
- `convex/schema.ts`: +7 lines (collaborationTokens table), -6 lines (cursorSessions table)
- `convex/collaboration.ts`: +193 lines (new file)
- `convex/http.ts`: +80 lines (verification endpoint)

**Backend (PartyKit)**
- `partykit/server.ts`: +38 lines (auth gate)

**Frontend**
- `src/hooks/use-yjs-provider.ts`: +88 lines (new file)
- `src/pages/App/Document/DocumentEditor.tsx`: -9 lines (removed cursor tracking)

**Deleted**
- `convex/cursorSessions.ts`: -88 lines
- `src/hooks/use-cursor-tracking.ts`: -176 lines
- `src/pages/App/Document/CursorOverlay.tsx`: -229 lines

**Net change**: -182 lines (cleanup outweighed new code)

### Next Steps

Phase 12 (Document Collaboration) will:
- Use `useYjsProvider` hook to connect to authenticated PartyKit rooms
- Migrate BlockNote from ProseMirror Sync to native Yjs collaboration
- Implement Yjs Awareness-based cursor tracking (replacing deleted RTK cursor system)
- Add user colors for cursor/presence visualization

Phase 13 (Diagram Collaboration) will:
- Reuse `useYjsProvider` hook for diagram rooms
- Integrate y-excalidraw for multiplayer diagram editing
- Reuse user colors from Phase 12 for consistency

## Self-Check: PASSED

**Created files:**
- [x] convex/collaboration.ts exists
- [x] src/hooks/use-yjs-provider.ts exists

**Modified files:**
- [x] convex/schema.ts updated with collaborationTokens table
- [x] convex/http.ts has /collaboration/verify endpoint
- [x] partykit/server.ts has auth gate
- [x] src/pages/App/Document/DocumentEditor.tsx cleaned up

**Deleted files:**
- [x] convex/cursorSessions.ts deleted
- [x] src/hooks/use-cursor-tracking.ts deleted
- [x] src/pages/App/Document/CursorOverlay.tsx deleted

**Commits:**
- [x] 4acc493 exists in git log (Task 1)
- [x] 576194d exists in git log (Task 2)

**Functionality:**
- [x] Schema deployed successfully (collaborationTokens added, cursorSessions removed)
- [x] No TypeScript errors (lint + build passed)
- [x] No remaining references to deleted RTK cursor code
