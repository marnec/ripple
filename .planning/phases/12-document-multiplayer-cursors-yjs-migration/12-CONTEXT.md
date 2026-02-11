# Phase 12: Document Multiplayer Cursors & Yjs Migration - Context

**Gathered:** 2026-02-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Real-time cursor awareness and Yjs-based collaboration for BlockNote documents. Replace ProseMirror Sync with Yjs CRDTs, show live cursors and text selections, and ensure custom BlockNote inline content types continue working with Yjs sync. Existing documents will be wiped (early dev) — no migration script needed.

</domain>

<decisions>
## Implementation Decisions

### Cursor & presence UI
- Colored caret + floating name label (Google Docs style)
- Translucent color overlay for other users' text selections (user-colored highlight)
- Active users displayed as top-right overlapping avatar stack in document header (Figma style)
- Cursors fade after 30s of idle, removed instantly on leave
- Stale cursors (unclean disconnect) removed after 10s

### Migration strategy
- No migration — wipe all existing documents on dev and production (early development)
- Full removal of ProseMirror Sync collaboration code — clean break, Yjs only
- Yjs/PartyKit is the single source of truth for document content — Convex stores metadata only (title, permissions, etc.)
- Remove the `content` field from the Convex documents schema entirely

### Conflict & offline behavior
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

</decisions>

<specifics>
## Specific Ideas

- y-indexeddb (https://github.com/yjs/y-indexeddb) for offline document persistence
- Cursor style inspired by Google Docs (caret + name label)
- Avatar stack inspired by Figma (overlapping circles, top-right)
- User colors must be consistent across documents and diagrams (reused in Phase 13)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-document-multiplayer-cursors-yjs-migration*
*Context gathered: 2026-02-11*
