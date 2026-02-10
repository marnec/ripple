# Architecture Patterns: Multiplayer Cursors & Collaboration

**Domain:** Multiplayer cursor awareness and real-time collaborative editing
**Researched:** 2026-02-10

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Ripple Frontend (React)                  │
│  ┌──────────────────┐              ┌────────────────────┐   │
│  │ DocumentEditor   │              │ ExcalidrawEditor   │   │
│  │                  │              │                    │   │
│  │ BlockNote        │              │ Excalidraw         │   │
│  │   + y-prosemirror│              │   + y-excalidraw   │   │
│  │   + ProseMirror  │              │                    │   │
│  │     Sync (keep)  │              │                    │   │
│  └─────┬────────────┘              └─────┬──────────────┘   │
│        │ Yjs Awareness (cursors)         │ Yjs (elements    │
│        │ ProseMirror Sync (content)      │      + cursors)  │
└────────┼─────────────────────────────────┼──────────────────┘
         │                                 │
         ├─────────────┬───────────────────┘
         │             │
         ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│              PartyKit Server (Cloudflare Edge)              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Durable Object per room (document/diagram)         │    │
│  │                                                      │    │
│  │  Y.Doc (Yjs document)                               │    │
│  │    ├─ awareness (cursors, presence)                 │    │
│  │    └─ fragments (content) - docs cursors-only       │    │
│  │                             diagrams full sync       │    │
│  │                                                      │    │
│  │  onLoad() - fetch from Convex (optional)            │    │
│  │  onSave() - persist snapshot to Durable Objects     │    │
│  │             (optional: push to Convex for backup)   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
         │ Optional backup
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Convex Backend                           │
│  ┌───────────────────┐     ┌────────────────────────────┐   │
│  │ documents table   │     │ diagrams table             │   │
│  │ (ProseMirror JSON)│     │ (JSON + optional Yjs blob) │   │
│  └───────────────────┘     └────────────────────────────┘   │
│                                                             │
│  Handles: permissions, queries, non-collaborative data      │
└─────────────────────────────────────────────────────────────┘
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **DocumentEditor** | BlockNote UI, ProseMirror Sync (content), Yjs Awareness (cursors) | PartyKit (cursors), Convex (content) |
| **ExcalidrawEditor** | Excalidraw UI, y-excalidraw binding (elements + cursors) | PartyKit (full sync) |
| **PartyKit YjsServer** | WebSocket provider, CRDT merging, persistence | Durable Objects (storage), Convex (optional backup) |
| **Convex Backend** | Permissions, queries, durable storage for non-collaborative data | Frontend (queries/mutations), PartyKit (optional backup) |
| **Yjs Awareness** | Ephemeral cursor/presence state (not persisted) | y-prosemirror, y-excalidraw |
| **Y.Doc** | Shared CRDT document state | Awareness (cursors), fragments (content if using Yjs sync) |

### Data Flow

**Document Cursors (Phase 1):**
1. User moves cursor in BlockNote editor
2. y-prosemirror updates Yjs Awareness state (local)
3. Yjs Awareness broadcasts to PartyKit (WebSocket)
4. PartyKit relays to all connected clients
5. Other clients receive Awareness update → y-prosemirror renders remote cursors
6. Content edits still go through ProseMirror Sync → Convex (unchanged)

**Diagram Collaboration (Phase 2):**
1. User edits Excalidraw element
2. y-excalidraw updates Y.Array (CRDT)
3. Yjs broadcasts update to PartyKit
4. PartyKit merges updates, relays to clients
5. Other clients receive update → y-excalidraw updates Excalidraw scene
6. Awareness handles cursors (same as documents)
7. Optional: PartyKit onSave() debounced → Convex backup

## Patterns to Follow

### Pattern 1: Dual Sync Strategy (Phase 1)

**What:** Keep ProseMirror Sync for content, add Yjs only for cursors

**When:** Phase 1 document cursors, avoiding migration risk

**Implementation:**
```typescript
// DocumentEditor.tsx
const sync = useBlockNoteSync(api.prosemirror, documentId, { /* existing */ });

// NEW: Add Yjs provider for cursors only
const yDoc = useMemo(() => new Y.Doc(), []);
const provider = useMemo(() => 
  new YPartyKitProvider(
    "partykit-host.lambda.workers.dev",
    `doc-${documentId}`,
    yDoc,
    { awareness: new Awareness(yDoc) }
  ), [documentId]
);

// BlockNote editor uses BOTH
const editor = useCreateBlockNote({
  collaboration: {
    provider,
    fragment: yDoc.getXmlFragment("awareness-only"), // empty fragment
    user: { name: user.name, color: userColor },
  },
  // ProseMirror Sync still handles content
});
```

**Why:** No data migration, minimal changes, proves infrastructure

### Pattern 2: Separate PartyKit Room per Resource

**What:** Each document/diagram gets its own Durable Object room

**When:** Always (isolation, permissions, scaling)

**Implementation:**
```typescript
// Document cursor room
const docProvider = new YPartyKitProvider(host, `doc-${docId}`, yDoc);

// Diagram collaboration room  
const diagramProvider = new YPartyKitProvider(host, `diagram-${diagramId}`, yDoc);
```

**Why:** 
- Permission isolation (Convex auth token per room)
- Independent scaling (popular docs don't affect others)
- Clear cleanup (delete room when resource deleted)

### Pattern 3: Auth via Convex Token

**What:** Validate PartyKit connections using Convex-generated tokens

**When:** Always (prevent unauthorized access)

**Implementation:**
```typescript
// Client side
const { authToken } = await ctx.action(api.collaboration.getToken, {
  resourceId: documentId,
  resourceType: "document",
});

const provider = new YPartyKitProvider(host, room, yDoc, {
  params: async () => ({ token: authToken }),
});

// PartyKit server side
export default class YjsServer implements Party.Server {
  async onBeforeConnect(req: Party.Request) {
    const token = new URL(req.url).searchParams.get("token");
    const valid = await validateConvexToken(token, this.party.env);
    if (!valid) return new Response("Unauthorized", { status: 401 });
  }
  
  onConnect(conn: Party.Connection) {
    return onConnect(conn, this.party, { persist: { mode: "snapshot" } });
  }
}
```

**Why:** Reuse Convex permissions, single source of truth for access control

### Pattern 4: Snapshot Persistence with Optional Convex Backup

**What:** PartyKit persists to Durable Objects, optionally syncs to Convex

**When:** Always use snapshot mode, Convex backup optional for export/audit

**Implementation:**
```typescript
// PartyKit server
export default class YjsServer extends YjsServerBase {
  constructor(public party: Party.Room) {
    super(party, {
      persist: { mode: "snapshot" },
      callback: {
        handler: async (doc: Y.Doc) => {
          // Optional: push to Convex for backup
          const update = Y.encodeStateAsUpdate(doc);
          await fetch(`${CONVEX_URL}/api/backup`, {
            method: "POST",
            body: JSON.stringify({
              roomId: this.party.id,
              update: Array.from(update),
            }),
          });
        },
        debounceWait: 2000,
        debounceMaxWait: 10000,
      },
    });
  }
}
```

**Why:** PartyKit handles real-time, Convex backup enables export/analytics

## Anti-Patterns to Avoid

### Anti-Pattern 1: Mixing Convex Optimistic Updates with Yjs CRDTs

**What:** Using both Convex mutations (with optimistic updates) and Yjs updates on same field

**Why bad:** 
- Convex optimistic updates roll back on conflict
- Yjs CRDTs never roll back (merge conflicts)
- Creates race conditions and UI flicker

**Instead:**
- Convex: Metadata (title, permissions, settings)
- Yjs: Collaborative content (cursors, elements, rich text if migrated)
- Clear boundary: high-frequency collaboration → Yjs, low-frequency updates → Convex

### Anti-Pattern 2: Shared PartyKit Room Across Resources

**What:** Using single room for all documents/diagrams with namespacing

**Why bad:**
- Permission boundary violation (user with access to one doc sees all updates)
- Scaling issues (popular resource affects all others in room)
- Complex cleanup logic

**Instead:** Separate room per resource (Pattern 2)

### Anti-Pattern 3: Persisting Awareness State

**What:** Storing cursor positions in Durable Objects or Convex

**Why bad:**
- Awareness is ephemeral (cursors disappear when user leaves)
- Wastes storage on transient data
- Stale cursor ghosts on reconnection

**Instead:** Awareness state stays in-memory only, cleared on disconnect

### Anti-Pattern 4: Immediate Full Yjs Migration (Phase 1)

**What:** Replacing ProseMirror Sync with Yjs sync in Phase 1

**Why bad:**
- Data migration risk (production data transformation)
- Unproven infrastructure (PartyKit untested in this codebase)
- Blocked on migration if issues arise

**Instead:** Dual sync (Pattern 1) proves infrastructure, migrate in Phase 3 if value proven

## Scalability Considerations

| Concern | At 10 users | At 100 users | At 1000 users |
|---------|-------------|--------------|---------------|
| **Cursor updates** | 10 users × 5 updates/s = 50/s per room. Durable Objects handle easily. | 100 × 5 = 500/s. Still fine (DO WebSockets handle 1000s/s). | 1000 × 5 = 5000/s. May need cursor throttling (already have 200ms throttle). |
| **PartyKit rooms** | ~10 concurrent documents. Free tier (5GB storage, limited requests). | ~100 rooms. May hit free tier limits, move to Paid ($5/mo). | ~1000 rooms. Hibernation API critical (reduces idle costs). |
| **Convex backup** | Optional, low frequency (onSave every 2-10s). No impact. | May add Convex action load. Monitor quota. | Use debounceMaxWait (10s) to limit backup frequency. |
| **Durable Objects storage** | Snapshot mode compacts history. Minimal storage per room. | 100 rooms × ~100KB snapshot = 10MB. Negligible. | 1000 rooms = 100MB. Well under 5GB free tier. |

**Cost estimates:**
- **Free tier sufficient for:** 10-50 concurrent users, ~100 active rooms
- **Paid tier ($5/mo) needed at:** 100+ concurrent users, 500+ rooms
- **Hibernation reduces costs:** DO sleeps when idle (no compute charges between messages)

## Sources

- [PartyKit Architecture Guide](https://docs.partykit.io/how-partykit-works/) — Durable Objects, room isolation
- [Yjs Architecture](https://docs.yjs.dev/) — CRDT fundamentals, Awareness vs document state
- [y-partykit Persistence](https://docs.partykit.io/reference/y-partykit-api/) — onLoad/onSave hooks, snapshot mode
- [Cloudflare Durable Objects Best Practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) — WebSocket patterns, hibernation

---
*Architecture patterns for: Multiplayer cursors and real-time collaboration*
*Researched: 2026-02-10*
