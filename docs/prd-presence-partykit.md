# PRD: Presence Tracking via PartyKit

## Problem

User presence (which page/resource someone is viewing) is currently tracked via a Convex `userPresence` table. This is architecturally wrong:

- **Ephemeral data in a persistent store.** Every navigation fires a Convex mutation (billed write). Rows linger after crashes and require a staleness heuristic (2-min TTL) to approximate what WebSocket disconnect gives for free.
- **Inconsistent with existing presence.** Document/diagram cursor presence already uses Yjs Awareness via PartyKit. Navigation presence going through a separate system creates two mental models.
- **Fragile cleanup.** The `clearPresence` mutation fires on component unmount, but tab crashes, network drops, and mobile backgrounding bypass it — leaving ghost entries.

PartyKit is already deployed, authenticated, and managing real-time state. It's the natural home for presence.

## Solution

Replace the Convex `userPresence` table with a PartyKit `presence-{workspaceId}` room. Each workspace gets one long-lived presence room where all members broadcast their current location. Disconnection = automatic removal.

## Architecture

### Current flow (Convex)

```
Route change → usePresenceBroadcaster → mutation(updatePresence) → Convex DB write
Follow mode → useQuery(getUserPresence) → Convex DB read (reactive subscription)
Unmount     → mutation(clearPresence) → Convex DB delete (fragile)
```

### Proposed flow (PartyKit)

```
Route change → useWorkspacePresence → ws.send({ type: "presence", path, resource })
                                    → PartyKit broadcasts to all room members
                                    → Local state updates via onMessage
Follow mode → read from local presence map (already in memory)
Disconnect  → PartyKit fires onClose → broadcasts user_left → automatic cleanup
```

## PartyKit Server Changes

### New room type: `presence-{workspaceId}`

The existing `CollaborationServer` handles `doc-*`, `diagram-*`, `task-*` rooms for Yjs sync. Presence rooms are a different concern — they don't use Yjs, don't persist snapshots, and have a simpler lifecycle. Two options:

**Option A: Separate party (recommended).** Define a second party in `partykit.json` with its own server file (`partykit/presence-server.ts`). This keeps the collaboration server focused on Yjs and avoids routing logic based on room ID prefix.

```jsonc
// partykit.json
{
  "name": "ripple-collaboration",
  "main": "partykit/server.ts",
  "parties": {
    "presence": "partykit/presence-server.ts"
  }
}
```

**Option B: Single server with routing.** Parse the room ID prefix and skip Yjs setup for `presence-*` rooms. Simpler config, messier code.

### `partykit/presence-server.ts`

```
State: Map<connectionId, { userId, userName, userImage, currentPath, resourceType?, resourceId? }>

onConnect(conn, ctx):
  - Verify auth token via Convex HTTP endpoint (same flow as CollaborationServer)
  - Store userId/userName on connection state
  - Broadcast "user_joined" with userId, userName to all other connections
  - Send current presence map snapshot to the new connection

onMessage(conn, msg):
  - Parse { type: "presence_update", currentPath, resourceType?, resourceId? }
  - Update connection's state in the map
  - Broadcast { type: "presence_changed", userId, currentPath, resourceType, resourceId } to all

onClose(conn):
  - Remove from presence map
  - Broadcast { type: "user_left", userId } to all remaining connections

No alarms, no persistence, no Yjs. Pure in-memory broadcast.
```

### Protocol messages (add to `shared/protocol/messages.ts`)

```typescript
// Client → Server
interface PresenceUpdateMessage {
  type: "presence_update";
  currentPath: string;
  resourceType?: string;  // "channel" | "document" | "diagram" | "project" | "task"
  resourceId?: string;
}

// Server → Client
interface PresenceSnapshotMessage {
  type: "presence_snapshot";
  users: Array<{
    userId: string;
    userName: string;
    userImage: string | null;
    currentPath: string;
    resourceType?: string;
    resourceId?: string;
  }>;
}

interface PresenceChangedMessage {
  type: "presence_changed";
  userId: string;
  userName: string;
  currentPath: string;
  resourceType?: string;
  resourceId?: string;
}
```

## Frontend Changes

### Replace `usePresenceBroadcaster` → `useWorkspacePresence`

New hook that manages the WebSocket connection to `presence-{workspaceId}`:

- On mount: fetch collaboration token, connect to PartyKit presence room
- On route change: send `presence_update` message (no debounce needed — WS messages are cheap)
- On incoming messages: update a local `Map<userId, PresenceEntry>` state
- On unmount: disconnect (PartyKit handles cleanup server-side)
- Exposes: `presenceMap`, `isConnected`

### Replace `useQuery(getUserPresence)` in FollowModeContext

Instead of subscribing to a Convex query, the FollowModeContext reads from the `presenceMap` provided by `useWorkspacePresence`. When the followed user's entry changes in the map, trigger navigation.

The hook returns the full map. Follow mode filters to the target userId client-side — no server round-trip.

### Auth flow

Reuse the existing `getCollaborationToken` action. Currently it validates per-resource access (`checkDocumentAccess`, etc.). For presence rooms, validate workspace membership instead:

- Add a `checkWorkspaceAccess` internal query to `convex/collaboration.ts`
- Token roomId format: `presence-{workspaceId}`
- Verify endpoint checks `workspaceMembers.by_workspace_user` index

### Connection lifecycle

The presence WebSocket should be:
- Opened when entering a workspace (workspaceId available in params)
- Kept alive across navigation within the workspace
- Closed when leaving the workspace or logging out
- Reconnected with exponential backoff on drops (reuse patterns from `useYjsProvider`)

This is a single long-lived connection per workspace session, not per-page like the Yjs connections.

## Convex Cleanup

Remove:
- `userPresence` table from `convex/schema.ts`
- `convex/userPresence.ts` (all 4 functions)
- Schema migration to drop the table

## What doesn't change

- `ActiveCallContext` — untouched, still manages RTK meeting state
- `FloatingCallWindow` — untouched
- `FollowModeIndicator` — untouched (reads from context, doesn't care about transport)
- Follow buttons on participant tiles — untouched
- Existing Yjs collaboration rooms — untouched, separate concern

## Risks

| Risk | Mitigation |
|------|------------|
| PartyKit presence room cold-start adds latency on workspace entry | Room stays alive while any member is connected. First user pays ~200ms cold-start. |
| Presence data lost if PartyKit goes down | Acceptable — presence is ephemeral. Users just don't see who's online until it recovers. Collaboration (Yjs) rooms are independent. |
| Extra WebSocket connection per workspace | Lightweight — presence messages are small JSON, no binary sync. PartyKit handles thousands of connections per room. |
| Token expiry during long sessions | Implement token refresh (same pattern as Yjs provider — `TOKEN_REFRESH_REQUIRED` error triggers re-auth). |

## Success criteria

1. Presence updates appear within 200ms for other workspace members (vs ~500ms+ with Convex mutation + query subscription)
2. Tab crash or network loss removes user from presence within 30s (PartyKit WebSocket timeout) with zero cleanup code
3. Zero Convex mutations for navigation — presence is fully off the billing path
4. Follow mode works identically from the user's perspective
5. `npm run lint && npm run build` pass
