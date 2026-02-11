# Phase 12: Document Multiplayer Cursors & Yjs Migration - Research

**Researched:** 2026-02-11
**Domain:** Real-time collaborative document editing with Yjs CRDTs, cursor awareness, and offline persistence
**Confidence:** HIGH

## Summary

Phase 12 migrates BlockNote documents from ProseMirror Sync to Yjs-based collaboration with real-time cursor awareness. The stack is well-established: BlockNote 0.46.2 has first-class Yjs integration, y-partykit handles WebSocket transport (already deployed in Phase 11), and y-indexeddb provides offline persistence. The main technical challenges are: (1) implementing cursor rendering with Yjs Awareness API, (2) ensuring custom inline content types (mentions, diagrams) serialize correctly with Yjs, and (3) managing consistent user colors across documents and diagrams.

**Primary recommendation:** Use BlockNote's built-in `collaboration` option with y-partykit provider (existing useYjsProvider hook), implement cursor UI via Yjs Awareness API with custom React overlay component, and assign consistent colors using a deterministic hash function (color-hash NPM package) based on userId.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Cursor & presence UI
- Colored caret + floating name label (Google Docs style)
- Translucent color overlay for other users' text selections (user-colored highlight)
- Active users displayed as top-right overlapping avatar stack in document header (Figma style)
- Cursors fade after 30s of idle, removed instantly on leave
- Stale cursors (unclean disconnect) removed after 10s

#### Migration strategy
- No migration — wipe all existing documents on dev and production (early development)
- Full removal of ProseMirror Sync collaboration code — clean break, Yjs only
- Yjs/PartyKit is the single source of truth for document content — Convex stores metadata only (title, permissions, etc.)
- Remove the `content` field from the Convex documents schema entirely

#### Conflict & offline behavior
- Yjs CRDT auto-merge for concurrent edits (character-level, both edits preserved)
- Buffer local changes offline, sync automatically on reconnect (user can keep typing)
- Use y-indexeddb for client-side offline persistence (changes survive browser refresh)
- Only cache documents the user has opened (not all accessible documents)
- Subtle connection status icon in document header (green/yellow/red)
- Small sync icon visible when local changes are pending sync to server

### Claude's Discretion
- User color assignment algorithm (consistent per user across documents/diagrams — per AWARE-03)
- Exact cursor label positioning and animation
- Connection status icon design
- y-indexeddb cache eviction strategy
- Sync icon design and placement

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope

</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| yjs | ^13.6.29 | CRDT document sync | Industry-standard CRDT for collaborative editing, character-level conflict resolution |
| y-partykit | ^0.0.33 | WebSocket provider | Already deployed in Phase 11, handles Yjs transport over PartyKit |
| @blocknote/core | 0.46.2 | Block-based editor | First-class Yjs integration via `collaboration` option |
| @blocknote/react | 0.46.2 | React bindings | useCreateBlockNote hook accepts Yjs provider |
| y-indexeddb | Latest | Offline persistence | Official Yjs provider for IndexedDB, automatic sync on reconnect |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| color-hash | Latest | Consistent color generation | Deterministic user color assignment from userId (HSL + SHA256) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| y-partykit | y-websocket | y-partykit already deployed, no benefit to switching |
| color-hash | Manual HSL calculation | color-hash is battle-tested, handles edge cases (readable colors, saturation control) |
| Yjs | Automerge, Gun.js | Yjs has best ProseMirror/BlockNote ecosystem support, proven at scale |

**Installation:**
```bash
npm install y-indexeddb color-hash
npm install --save-dev @types/color-hash
```

**Note:** yjs and y-partykit already installed in Phase 11.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── hooks/
│   ├── use-yjs-provider.ts           # Already exists from Phase 11
│   ├── use-document-collaboration.ts # NEW: BlockNote + Yjs integration
│   ├── use-user-color.ts             # NEW: Consistent color assignment
│   └── use-cursor-awareness.ts       # NEW: Awareness state management
├── pages/App/Document/
│   ├── DocumentEditor.tsx            # UPDATE: Replace ProseMirror Sync with Yjs
│   ├── CursorOverlay.tsx             # NEW: Render remote cursors
│   ├── ConnectionStatus.tsx          # NEW: Connection indicator
│   └── ActiveUsers.tsx               # NEW: Avatar stack (may already exist as FacePile)
└── lib/
    └── user-colors.ts                # NEW: color-hash wrapper, color palette

convex/
├── prosemirror.ts                    # DELETE: Remove entirely
├── schema.ts                         # UPDATE: Remove prosemirrorSync component
└── documents.ts                      # UPDATE: Remove content field references
```

### Pattern 1: BlockNote Yjs Integration
**What:** Configure BlockNote editor with Yjs collaboration via provider
**When to use:** Every document editor instance
**Example:**
```typescript
// Source: https://www.blocknotejs.org/examples/collaboration/partykit
import { useCreateBlockNote } from "@blocknote/react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

const { yDoc, provider, isConnected, isLoading } = useYjsProvider({
  resourceType: "doc",
  resourceId: documentId,
});

// Offline persistence
const indexeddbProvider = useMemo(
  () => new IndexeddbPersistence(documentId, yDoc),
  [documentId, yDoc]
);

// Get user color (consistent across app)
const userColor = useUserColor(currentUserId);

const editor = useCreateBlockNote({
  collaboration: {
    provider,
    fragment: yDoc.getXmlFragment("document-store"),
    user: {
      name: currentUser.name,
      color: userColor,
    },
  },
});
```

### Pattern 2: Yjs Awareness for Cursors
**What:** Use Awareness API to broadcast and observe cursor positions
**When to use:** Real-time cursor tracking in collaborative editors
**Example:**
```typescript
// Source: https://docs.yjs.dev/getting-started/adding-awareness
const awareness = provider.awareness;

// Set local cursor state
awareness.setLocalStateField('cursor', {
  anchor: selection.anchor,
  head: selection.head,
});

// Observe remote cursors
awareness.on('change', (changes) => {
  const states = Array.from(awareness.getStates().values());
  const remoteCursors = states.filter(state =>
    state.user && state.cursor && state.user.name !== currentUser.name
  );
  setRemoteCursors(remoteCursors);
});
```

### Pattern 3: Consistent User Colors
**What:** Generate deterministic color from userId using color-hash
**When to use:** Assign colors to users for cursors, selections, avatars
**Example:**
```typescript
// Source: https://github.com/zenozeng/color-hash
import ColorHash from 'color-hash';

const colorHash = new ColorHash({
  lightness: 0.6,  // Readable on white/dark backgrounds
  saturation: 0.7, // Vibrant but not overwhelming
});

export function getUserColor(userId: string): string {
  return colorHash.hex(userId); // Always returns same color for same userId
}
```

### Pattern 4: Connection Status Monitoring
**What:** Track provider connection and sync state for UI indicators
**When to use:** Show connection status to users
**Example:**
```typescript
// Source: https://discuss.yjs.dev/t/is-it-possible-to-monitor-the-y-websocket-connection-status/2265
const [connectionStatus, setConnectionStatus] = useState<'connected' | 'syncing' | 'offline'>('syncing');

useEffect(() => {
  if (!provider) return;

  provider.on('status', ({ status }: { status: string }) => {
    setConnectionStatus(status === 'connected' ? 'connected' : 'offline');
  });

  provider.on('sync', (synced: boolean) => {
    if (synced) setConnectionStatus('connected');
  });
}, [provider]);
```

### Pattern 5: Offline Persistence with y-indexeddb
**What:** Persist Yjs document to IndexedDB for offline editing
**When to use:** Every collaborative document (only cache opened documents)
**Example:**
```typescript
// Source: https://docs.yjs.dev/ecosystem/database-provider/y-indexeddb
import { IndexeddbPersistence } from 'y-indexeddb';

const indexeddbProvider = new IndexeddbPersistence(documentId, yDoc);

indexeddbProvider.on('synced', () => {
  console.log('Loaded from IndexedDB cache');
});

// Cleanup on unmount
useEffect(() => {
  return () => {
    indexeddbProvider.destroy();
  };
}, [indexeddbProvider]);
```

### Anti-Patterns to Avoid
- **Rehydrating Y.Doc from database after collaboration begins:** Calling `blocksToYDoc` on an active document destroys history and breaks undo/redo. Only use for initial import before first user connects.
- **Manual cursor timeout management:** Yjs Awareness automatically removes offline clients after 30s. Don't implement custom timeout logic unless handling edge cases.
- **Storing entire document in Convex:** Yjs/PartyKit is the source of truth for content. Convex stores only metadata (title, tags, permissions).
- **Global IndexedDB cache for all documents:** Only create IndexeddbPersistence for documents user has opened. Don't pre-cache all accessible documents (memory/storage waste).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cursor position tracking | Custom cursor coordinate system | Yjs Awareness API | Handles network state, timeouts, cleanup; editor bindings provide position data |
| Consistent color assignment | Random colors per session | color-hash library | Deterministic (same user = same color), handles HSL edge cases, configurable saturation/lightness |
| Offline sync queue | Custom operation queue with retry logic | y-indexeddb + Yjs auto-sync | Yjs automatically buffers local changes, syncs on reconnect; IndexedDB persists across sessions |
| Conflict resolution | Last-write-wins or manual merge UI | Yjs CRDT | Character-level auto-merge, preserves all edits, proven at Google Docs scale |
| Connection state management | Custom WebSocket reconnect logic | y-partykit provider events | Built-in reconnect, exponential backoff, status events |

**Key insight:** Yjs ecosystem solves 90% of collaborative editing problems. Custom solutions introduce bugs Yjs already solved (partial sync failures, undo/redo with CRDTs, awareness cleanup on disconnect).

## Common Pitfalls

### Pitfall 1: Custom Inline Content Not Serializing with Yjs
**What goes wrong:** Custom inline content types (mentions, diagram references) may not serialize to Yjs XmlFragment correctly, causing content loss on sync.
**Why it happens:** BlockNote custom inline content uses ProseMirror schema extensions. Yjs must understand how to serialize/deserialize these custom nodes.
**How to avoid:** BlockNote's Yjs integration automatically handles custom schemas IF they follow the standard createReactInlineContentSpec pattern. Test by: (1) insert custom inline content, (2) reload page with IndexedDB cache, (3) verify content restored correctly.
**Warning signs:** Custom inline content disappears after page reload or shows as plain text instead of React component.

### Pitfall 2: Cursor State Persisting After Disconnect
**What goes wrong:** Remote cursors remain visible after user disconnects (unclean disconnect due to network failure).
**Why it happens:** Awareness timeout is 30s by default. If network dies, remote clients won't detect disconnect until timeout.
**How to avoid:** Locked decision: "Stale cursors removed after 10s". Implement client-side timeout: if cursor hasn't updated in 10s, filter it from render. Yjs Awareness change events include timestamp metadata.
**Warning signs:** Ghost cursors lingering after user closes browser tab.

### Pitfall 3: y-indexeddb Cache Growing Unbounded
**What goes wrong:** IndexedDB storage grows indefinitely as user opens documents, eventually hitting browser quota limits (10% of disk in Firefox, 60% in Chrome).
**Why it happens:** y-indexeddb persists every document opened. No automatic eviction.
**How to avoid:** Implement LRU cache eviction: track document access timestamps, periodically call `indexeddbProvider.clearData()` on least-recently-used documents when approaching storage quota. Use `navigator.storage.estimate()` to monitor usage.
**Warning signs:** Browser storage quota exceeded errors after using app for weeks.

### Pitfall 4: Removing ProseMirror Sync Breaks Existing Documents
**What goes wrong:** Documents created with ProseMirror Sync are in a different format than Yjs expects, causing errors on load.
**Why it happens:** ProseMirror Sync stores JSON snapshots + operational transform steps. Yjs stores binary CRDT state.
**How to avoid:** Locked decision: "No migration — wipe all existing documents". Delete all document content before deploying Phase 12. Remove `prosemirror.ts`, remove `@convex-dev/prosemirror-sync` component from schema, remove `content` field from documents table.
**Warning signs:** N/A (wipe prevents this issue entirely).

### Pitfall 5: Awareness State Not Updating on Idle
**What goes wrong:** Cursor position updates stop broadcasting when user is idle, causing remote users to see stale cursor.
**Why it happens:** Awareness requires periodic updates. If client doesn't update local state, remote clients don't receive updates and may timeout the client.
**How to avoid:** Locked decision: "Cursors fade after 30s of idle". This is DESIRED behavior. Implement fade UI (reduce opacity) rather than removing cursor entirely. Yjs Awareness timeout (30s) will eventually remove truly offline clients.
**Warning signs:** Cursors disappearing prematurely when user is reading but not typing.

### Pitfall 6: Color Consistency Across Documents/Diagrams
**What goes wrong:** User gets different colors in different documents or between documents and diagrams.
**Why it happens:** Using random color assignment per session/resource instead of deterministic hash.
**How to avoid:** Locked decision (AWARE-03): "User colors consistent per user across all documents and diagrams". Use color-hash with userId as input (NOT sessionId or documentId). Store color in global state or compute on-demand (color-hash is fast, <1ms).
**Warning signs:** User avatar shows one color in sidebar, different color in document cursor.

## Code Examples

Verified patterns from official sources:

### BlockNote + Yjs Setup
```typescript
// Source: https://www.blocknotejs.org/docs/features/collaboration
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

function DocumentEditor({ documentId }: { documentId: string }) {
  const currentUser = useQuery(api.users.viewer);
  const { yDoc, provider, isConnected } = useYjsProvider({
    resourceType: "doc",
    resourceId: documentId,
  });

  // Offline persistence
  const indexeddbProvider = useMemo(
    () => new IndexeddbPersistence(`doc-${documentId}`, yDoc),
    [documentId, yDoc]
  );

  const userColor = useUserColor(currentUser._id);

  const editor = useCreateBlockNote({
    collaboration: {
      provider,
      fragment: yDoc.getXmlFragment("document-store"),
      user: {
        name: currentUser.name,
        color: userColor,
      },
    },
  });

  return (
    <div>
      <ConnectionStatus isConnected={isConnected} />
      <CursorOverlay awareness={provider.awareness} />
      <BlockNoteView editor={editor} />
    </div>
  );
}
```

### Cursor Awareness Integration
```typescript
// Source: https://docs.yjs.dev/getting-started/adding-awareness
import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";

interface RemoteCursor {
  clientId: number;
  user: { name: string; color: string };
  cursor?: { anchor: number; head: number };
  lastUpdate: number;
}

function useCursorAwareness(awareness: Awareness | null) {
  const [cursors, setCursors] = useState<RemoteCursor[]>([]);

  useEffect(() => {
    if (!awareness) return;

    const updateCursors = () => {
      const states = awareness.getStates();
      const now = Date.now();
      const remoteCursors: RemoteCursor[] = [];

      states.forEach((state, clientId) => {
        if (clientId === awareness.clientID) return; // Skip local user
        if (!state.user) return;

        remoteCursors.push({
          clientId,
          user: state.user,
          cursor: state.cursor,
          lastUpdate: now,
        });
      });

      setCursors(remoteCursors);
    };

    awareness.on('change', updateCursors);
    updateCursors(); // Initial load

    return () => {
      awareness.off('change', updateCursors);
    };
  }, [awareness]);

  // Filter stale cursors (>10s old per locked decision)
  const activeCursors = cursors.filter(c =>
    Date.now() - c.lastUpdate < 10000
  );

  return activeCursors;
}
```

### Consistent Color Assignment
```typescript
// Source: https://github.com/zenozeng/color-hash
import ColorHash from 'color-hash';

const colorHasher = new ColorHash({
  lightness: [0.5, 0.6, 0.7], // Multiple lightness options
  saturation: [0.6, 0.7, 0.8], // Multiple saturation options
});

export function useUserColor(userId: string): string {
  return useMemo(() => colorHasher.hex(userId), [userId]);
}

// For translucent selection highlights
export function getUserColorWithAlpha(userId: string, alpha: number): string {
  const hex = colorHasher.hex(userId);
  // Convert hex to rgba
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
```

### Connection Status Monitoring
```typescript
// Source: https://docs.yjs.dev/ecosystem/connection-provider/y-websocket
function useConnectionStatus(provider: YPartyKitProvider | null) {
  const [status, setStatus] = useState<'connected' | 'syncing' | 'offline'>('syncing');

  useEffect(() => {
    if (!provider) return;

    const handleStatus = ({ status }: { status: string }) => {
      setStatus(status === 'connected' ? 'connected' : 'offline');
    };

    const handleSync = (synced: boolean) => {
      if (synced) setStatus('connected');
    };

    provider.on('status', handleStatus);
    provider.on('sync', handleSync);

    return () => {
      provider.off('status', handleStatus);
      provider.off('sync', handleSync);
    };
  }, [provider]);

  return status;
}
```

### Cache Eviction Strategy
```typescript
// Source: https://web.dev/indexeddb-best-practices/
// Claude's discretion: LRU eviction when approaching quota

interface CacheEntry {
  documentId: string;
  lastAccessed: number;
  provider: IndexeddbPersistence;
}

const documentCache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 50; // Maximum documents to cache

async function getCacheUsage(): Promise<number> {
  const estimate = await navigator.storage.estimate();
  return (estimate.usage || 0) / (estimate.quota || 1);
}

async function evictLRU() {
  const usage = await getCacheUsage();
  if (usage < 0.5 && documentCache.size < MAX_CACHE_SIZE) return;

  const entries = Array.from(documentCache.entries())
    .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

  const toEvict = entries.slice(0, 10); // Evict 10 oldest
  for (const [docId, entry] of toEvict) {
    await entry.provider.clearData();
    entry.provider.destroy();
    documentCache.delete(docId);
  }
}

function trackDocumentAccess(documentId: string, provider: IndexeddbPersistence) {
  const existing = documentCache.get(documentId);
  if (existing) {
    existing.lastAccessed = Date.now();
  } else {
    documentCache.set(documentId, {
      documentId,
      lastAccessed: Date.now(),
      provider,
    });
    void evictLRU(); // Run eviction async
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ProseMirror Sync (OT) | Yjs (CRDT) | Phase 12 | Better conflict resolution (character-level), no server-side OT coordination, offline-first |
| Convex stores content | PartyKit stores content | Phase 12 | Convex becomes metadata store (title, permissions), PartyKit handles real-time sync |
| RTK cursor tracking | Yjs Awareness | Phase 11/12 | Native cursor support in Yjs ecosystem, automatic cleanup, lower latency |
| Manual color assignment | Deterministic hash | Phase 12 | Consistent colors across app, no database storage needed |

**Deprecated/outdated:**
- `@convex-dev/prosemirror-sync`: Remove from dependencies and schema after Phase 12 (replaced by Yjs)
- `convex/prosemirror.ts`: Delete entirely (no Convex-side document content storage)
- RTK cursor tracking (`use-cursor-tracking.ts`, `CursorOverlay.tsx`): Removed in Phase 11, replaced with Yjs Awareness in Phase 12

## Open Questions

1. **Cursor rendering in BlockNote**
   - What we know: BlockNote Yjs integration handles document sync; Awareness API provides cursor data
   - What's unclear: Does BlockNote automatically render remote cursors, or do we need a custom overlay?
   - Recommendation: Test BlockNote 0.46.2 collaboration mode to see if cursor rendering is built-in. If not, implement custom overlay using Awareness API + CSS absolutely positioned elements (similar to y-prosemirror pattern).

2. **Custom inline content Yjs compatibility**
   - What we know: BlockNote provides `blocksToYDoc` and `yDocToBlocks` utilities for conversion
   - What's unclear: Do custom inline content types (mention: User, diagram references) automatically serialize with Yjs, or do we need custom conversion logic?
   - Recommendation: Create test document with all custom inline content types, enable Yjs sync, verify content persists correctly with IndexedDB reload. If issues arise, check BlockNote Yjs utilities documentation for custom schema handling.

3. **Idle cursor fade implementation**
   - What we know: Locked decision requires 30s idle fade, 10s stale removal
   - What's unclear: How to detect "idle" vs "active but not moving cursor" (user reading/thinking)
   - Recommendation: Use Awareness state update timestamps. If `cursor` field hasn't changed in 30s, apply CSS opacity fade. After 10s total inactivity, filter from render. Don't remove from Awareness (Yjs handles that at 30s timeout).

## Sources

### Primary (HIGH confidence)
- BlockNote Collaboration Docs: https://www.blocknotejs.org/docs/features/collaboration
- BlockNote PartyKit Example: https://www.blocknotejs.org/examples/collaboration/partykit
- BlockNote Yjs Utilities: https://www.blocknotejs.org/docs/reference/editor/yjs-utilities
- Yjs Awareness API: https://docs.yjs.dev/getting-started/adding-awareness
- Yjs Awareness Reference: https://docs.yjs.dev/api/about-awareness
- y-indexeddb Docs: https://docs.yjs.dev/ecosystem/database-provider/y-indexeddb
- y-indexeddb GitHub: https://github.com/yjs/y-indexeddb
- y-prosemirror README: https://github.com/yjs/y-prosemirror/blob/master/README.md

### Secondary (MEDIUM confidence)
- color-hash NPM: https://www.npmjs.com/package/color-hash
- color-hash GitHub: https://github.com/zenozeng/color-hash
- Yjs connection status discussion: https://discuss.yjs.dev/t/is-it-possible-to-monitor-the-y-websocket-connection-status/2265
- IndexedDB best practices: https://web.dev/indexeddb-best-practices/
- IndexedDB storage quotas MDN: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- Awareness stale client cleanup: https://docs.yjs.dev/api/about-awareness (timeout behavior)

### Tertiary (LOW confidence - informational only)
- ProseMirror cursor colors article: https://medium.com/collaborne-engineering/cursor-colors-with-prosemirror-yjs-76a04b836566
- BlockNote custom inline content: https://www.blocknotejs.org/docs/custom-schemas/custom-inline-content
- Yjs Fundamentals Part 2 (Medium): https://medium.com/dovetail-engineering/yjs-fundamentals-part-2-sync-awareness-73b8fabc2233

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - BlockNote 0.46.2 already installed, Yjs integration documented, Phase 11 completed PartyKit setup
- Architecture: HIGH - Official BlockNote + PartyKit example demonstrates exact pattern, Awareness API well-documented
- Pitfalls: MEDIUM-HIGH - Stale cursor cleanup and custom content serialization need testing; IndexedDB eviction strategy is Claude's discretion (no user-specified approach)

**Research date:** 2026-02-11
**Valid until:** 2026-03-13 (30 days - stable ecosystem, BlockNote 0.46.2 current)

**Phase 11 foundation:** PartyKit server deployed with Yjs persistence, authentication via Convex tokens, useYjsProvider hook ready for consumption. Phase 12 builds on this foundation by connecting BlockNote editor to existing infrastructure.

**Key unknowns requiring validation during planning/execution:**
1. BlockNote cursor rendering capabilities (built-in vs custom overlay)
2. Custom inline content Yjs serialization behavior
3. Optimal IndexedDB cache size before eviction (Claude's discretion)
