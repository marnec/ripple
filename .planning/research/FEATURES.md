# Feature Landscape: Multiplayer Cursors & Collaboration

**Domain:** Multiplayer cursor awareness and real-time collaborative editing
**Researched:** 2026-02-10

## Table Stakes

Features users expect from multiplayer collaboration. Missing = product feels broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Cursor positions | Users need to see where collaborators are working | Medium | Yjs Awareness provides CRDT guarantees for cursor state |
| User identification | Cursors must show who they belong to (name, color) | Low | Standard Yjs Awareness user object (name, color fields) |
| Cursor updates <100ms | Laggy cursors feel broken | Medium | y-partykit on edge, no rate limits (unlike RTK 5/s limit) |
| Conflict-free merging | Multiple users editing same area shouldn't create conflicts | High | Yjs CRDT handles this automatically (core value prop) |
| Presence indicators | Show who's currently in document/diagram | Low | Yjs Awareness tracks online/offline state |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Edge-deployed collaboration | Sub-50ms latency via Cloudflare edge (PartyKit) | Low | Runs on existing Wrangler infra, free tier available |
| Serverless architecture | No collaboration server to maintain | Low | PartyKit Durable Objects, hibernation reduces costs |
| Unified cursor + content sync (Phase 3) | Single system for all collaboration | High | Requires migration from ProseMirror Sync to Yjs |
| Offline editing support (Phase 3) | Work offline, sync when reconnected | Medium | Yjs CRDT enables this, requires full migration |
| Diagram multiplayer | Real-time Excalidraw collaboration | Medium | y-excalidraw binding, element-level CRDT |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Video/voice built into cursors | Scope creep - already have WebRTC video calls | Keep separate systems (cursors for editing, WebRTC for calls) |
| Chat in collaboration layer | Convex handles chat with existing infrastructure | Don't add Yjs-based chat (Convex Presence + messages table works) |
| Shared cursors for non-editing contexts | Cursor tracking only valuable in editors (documents, diagrams) | Scope to DocumentEditor and ExcalidrawEditor only |
| Threaded comments on cursor positions | Over-engineered for v1, chat already exists | Use existing channel messages for communication |
| Cursor history/playback | Nice-to-have but complex, low ROI | Defer indefinitely unless user research shows value |

## Feature Dependencies

```
Cursor Awareness (Phase 1)
  ↓ requires
PartyKit Infrastructure (Phase 1)
  ↓ enables
Excalidraw Multiplayer (Phase 2)
  ↓ requires
y-excalidraw binding (Phase 2)

Full Yjs Migration (Phase 3 - optional)
  ↓ requires
Data Migration (ProseMirror → Yjs)
  ↓ enables
Offline Editing (Phase 3)
```

## MVP Recommendation

**Phase 1 Priority:**
1. PartyKit server setup (Cloudflare deployment)
2. Document cursor awareness (Yjs Awareness + y-prosemirror)
3. User identification (name, color via Awareness user object)
4. Presence facepile integration (show who's online in document)

**Defer to Phase 2:**
- Excalidraw multiplayer (lower usage than documents)
- y-excalidraw vendoring (community library risk)

**Defer to Phase 3 (optional):**
- Full Yjs migration (only if Phase 1/2 proves value)
- Offline editing (requires full migration)
- Unified content + cursor sync

## Implementation Notes

**BlockNote cursor rendering:**
- Yjs Awareness provides cursor positions as ProseMirror positions
- y-prosemirror plugin renders cursors with user color/name
- No custom cursor rendering needed (handled by binding)

**Excalidraw cursor rendering:**
- y-excalidraw provides remote cursor positions via Awareness
- Excalidraw has built-in collaborator cursors API
- Binding connects Yjs Awareness → Excalidraw collaborators state

**Cursor colors:**
- Generate consistent colors per user (hash userId → HSL)
- Store in Yjs Awareness user object on connection
- Same pattern as existing presence system

## Sources

- [Yjs Awareness Documentation](https://docs.yjs.dev/getting-started/adding-awareness) — Cursor state management
- [BlockNote Collaboration Example](https://www.blocknotejs.org/examples/collaboration/partykit) — Cursor rendering
- [Excalidraw Collaboration Blog](https://plus.excalidraw.com/blog/building-excalidraw-p2p-collaboration-feature) — Cursor and presence patterns

---
*Feature landscape for: Multiplayer cursors and real-time collaboration*
*Researched: 2026-02-10*
