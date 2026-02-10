# Stack Research: Multiplayer Cursors & Real-Time Collaboration

**Domain:** Multiplayer cursor awareness and collaborative editing infrastructure
**Researched:** 2026-02-10
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Yjs** | 13.6.29 | CRDT for conflict-free collaborative editing | Fastest CRDT implementation, state-based awareness for cursors, industry standard for real-time collaboration. BlockNote has first-class integration. |
| **PartyKit (y-partykit)** | 0.0.33 | WebSocket provider running on Cloudflare Workers/Durable Objects | Serverless, runs on Cloudflare edge, Yjs-native persistence (snapshot/history modes), acquired by Cloudflare (maintained), hibernation API for cost efficiency. |
| **y-prosemirror** | 1.3.7 | Yjs binding for ProseMirror editors | Official Yjs binding for ProseMirror (BlockNote's foundation), cursor awareness built-in, proven integration path. |
| **y-excalidraw** | No official npm package | Yjs binding for Excalidraw whiteboards | Community library (RahulBadenkal/y-excalidraw on GitHub), binds Y.Array to Excalidraw elements, synchronizes at element level (not key level). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **partykit** | 0.0.115 | PartyKit CLI and development tools | Development server for local testing, deployment to Cloudflare |
| **partyserver** | Latest | Base class for PartyKit servers | When building custom PartyKit servers with lifecycle hooks |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| PartyKit CLI | Local development server for testing collaboration | Run `npx partykit dev` for local testing |
| Cloudflare Wrangler | Deploy PartyKit to your own Cloudflare account | Already in project (wrangler 4.63.0) |

## Installation

```bash
# Core collaboration libraries
npm install yjs@13.6.29 y-partykit@0.0.33

# ProseMirror Yjs binding (BlockNote integration)
npm install y-prosemirror@1.3.7

# Excalidraw Yjs binding (install from GitHub - no npm package)
# Note: May need to vendor or fork this library
# npm install github:RahulBadenkal/y-excalidraw

# PartyKit development (already have wrangler)
npm install -D partykit@0.0.115
```

## Alternatives Considered

| Category | Recommended | Alternative | When to Use Alternative |
|----------|-------------|-------------|-------------------------|
| **CRDT Library** | Yjs | Automerge | Need JSON CRDT instead of specialized types. Yjs is 10-100x faster for text editing. |
| **WebSocket Provider** | PartyKit (y-partykit) | y-websocket + custom server | Need non-Cloudflare hosting (AWS, self-hosted). PartyKit is serverless and edge-native. |
| **WebSocket Provider** | PartyKit | Liveblocks | Budget for hosted service ($29+/mo). Liveblocks has managed infrastructure but higher cost. |
| **WebSocket Provider** | PartyKit | Y-Sweet (Jamsocket) | Need dedicated collaboration server. Y-Sweet adds server complexity vs PartyKit serverless. |
| **WebSocket Provider** | PartyKit | Hocuspocus | Self-hosting Node.js server. More control but operational overhead. |
| **Cursor Tracking** | Yjs Awareness | Cloudflare RTK | RTK has 5 events/s rate limit (too slow for cursors), already attempted and failed. |
| **Cursor Tracking** | Yjs Awareness | Custom Convex presence | Convex Presence lacks CRDT guarantees, cursor positions need conflict-free merging. |
| **BlockNote Sync** | Yjs (via y-prosemirror) | @convex-dev/prosemirror-sync | Keep existing ProseMirror Sync if not adding Yjs. Migration requires data transform. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Cloudflare RTK** | 5 events/s rate limit too slow for cursor tracking (200ms throttle needed = 5 events/s theoretical max, no headroom) | Yjs Awareness via PartyKit (no rate limit on Durable Objects WebSockets) |
| **@convex-dev/prosemirror-sync for cursors** | No awareness API, document sync only | Yjs Awareness (state-based CRDT for presence) |
| **Mixing Yjs + ProseMirror Sync** | Dual sync systems create conflicts, different data models | Migrate fully to Yjs OR keep ProseMirror Sync (pick one) |
| **Official Excalidraw collab server** | Requires Socket.IO server, not serverless | y-excalidraw with PartyKit |
| **y-websocket without hibernation** | Keeps WebSocket connections active 24/7, expensive on serverless | PartyKit with hibernation mode |

## Stack Patterns by Variant

**If migrating BlockNote from ProseMirror Sync to Yjs:**
- Use BlockNote's `collaboration` prop with y-partykit provider
- Migrate document data: convert ProseMirror JSON to Yjs updates (one-time)
- Benefits: Unified cursor awareness + document sync, better offline support
- Cost: Data migration required, different data model

**If keeping ProseMirror Sync for BlockNote:**
- Add separate Yjs document for cursor-only awareness
- Use Yjs Awareness without syncing document content
- Benefits: No data migration, minimal changes
- Cost: Dual systems (ProseMirror Sync + Yjs), more complexity

**If adding Excalidraw collaboration:**
- Use y-excalidraw binding (vendor from GitHub)
- Separate PartyKit room per diagram OR shared room with namespaced Y.Arrays
- Replace existing `reconcileElements` approach with Yjs CRDT
- Benefits: True multiplayer with conflict resolution, cursor awareness
- Cost: Community library (no official npm package), need to vendor/maintain

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| yjs@13.6.29 | y-partykit@0.0.33 | y-partykit peer depends on yjs ^13.0.0 |
| yjs@13.6.29 | y-prosemirror@1.3.7 | y-prosemirror peer depends on yjs >= 13.0.0 |
| @blocknote/core@0.46.2 | y-prosemirror@1.3.7 | BlockNote built on ProseMirror, official Yjs integration documented |
| @excalidraw/excalidraw@0.18.0 | y-excalidraw (no version) | y-excalidraw community library, no official package |
| partykit@0.0.115 | Cloudflare Workers | PartyKit uses Durable Objects, requires Cloudflare account |

## Integration with Existing Stack

### PartyKit + Convex Backend Integration

**Persistence Strategy:**
- **PartyKit handles:** Real-time WebSocket sync, CRDT merging, in-memory state
- **Convex handles:** Durable storage, permissions, queries, non-collaborative data

**Two integration approaches:**

1. **PartyKit Snapshot Mode → Convex** (Recommended)
   - PartyKit persists to Durable Objects storage (snapshot mode)
   - Periodic sync: PartyKit → Convex action (Y.encodeStateAsUpdate → Convex mutation)
   - Use PartyKit's `onSave()` hook with debounced callback
   - Convex stores Yjs binary updates as blobs for backup/export
   - Benefits: Simple, PartyKit handles all real-time, Convex is backup
   - Drawbacks: Two sources of truth (eventual consistency)

2. **PartyKit with Convex Persistence Hooks** (Advanced)
   - Implement `onLoad()` → fetch from Convex on room creation
   - Implement `onSave()` → push to Convex on updates
   - PartyKit becomes stateless proxy, Convex is source of truth
   - Benefits: Single source of truth (Convex)
   - Drawbacks: Latency on load, more Convex action calls

**Recommended approach:** Start with PartyKit snapshot mode (built-in Durable Objects storage). Add Convex sync later if needed for export/backup.

### BlockNote Migration Path

**Current:** `@convex-dev/prosemirror-sync` (ProseMirror Sync)
**Target:** Yjs with y-partykit provider

**Migration options:**

1. **Keep ProseMirror Sync, add Yjs for cursors only**
   - Minimal change: Add Yjs Awareness without document sync
   - Separate Y.Doc for cursor awareness, use y-partykit provider
   - BlockNote stays on ProseMirror Sync for content
   - No data migration required
   - Dual systems complexity

2. **Full migration to Yjs**
   - Replace `useBlockNoteSync` with `useCreateBlockNote` + `collaboration` prop
   - One-time data migration: ProseMirror JSON → Yjs updates
   - Unified cursor + content sync
   - Cleaner architecture, but requires migration

**Recommendation:** Start with option 1 (cursors only) for Phase 1. Evaluate Yjs migration in later phase if full collaboration needed.

### Excalidraw Collaboration

**Current:** Manual `reconcileElements` + debounced save to Convex
**Target:** Yjs CRDT with y-excalidraw binding

**Integration:**
- Replace `onChange` → `debouncedSave` with Yjs binding
- y-excalidraw handles conflict resolution (no manual reconcile)
- Excalidraw API `.updateScene()` called by binding
- Separate PartyKit room per diagram (or namespaced Y.Arrays)

**Note:** y-excalidraw is community library (not official npm package). Consider vendoring or forking for stability.

## Convex Optimistic Updates vs Yjs

**Conflict:**
- Convex uses optimistic updates (local prediction, rollback on mismatch)
- Yjs uses CRDTs (local apply, guaranteed merge, no rollback)

**Coexistence strategy:**
- **Convex optimistic updates:** Non-collaborative data (workspace settings, permissions, non-real-time fields)
- **Yjs CRDTs:** Collaborative data (document content, diagram elements, cursor positions)
- **Avoid:** Mixing optimistic updates + Yjs on same data (conflicts)

**Example:**
- Document title change → Convex mutation with optimistic update (infrequent, no conflicts)
- Document content editing → Yjs CRDT (frequent, conflict resolution needed)
- Cursor positions → Yjs Awareness (ephemeral, high frequency)

## PartyKit Pricing & Free Tier

**PartyKit platform fee:** $0 (free, acquired by Cloudflare)

**Underlying costs:** Cloudflare Workers pricing
- **Free tier:** 5 GB Durable Objects storage, limited requests/day
- **Paid tier:** $5/month minimum (Workers Paid plan)

**Cost optimization:**
- Use PartyKit hibernation mode (WebSocket hibernation API)
- Durable Object sleeps between messages, wakes on activity
- Reduces compute charges vs always-active connections

**Compared to previous RTK:**
- RTK has 5 events/s rate limit (blocker)
- PartyKit has no rate limit on WebSocket messages (uses Durable Objects, not Calls API)

## Sources

- [Yjs npm package](https://www.npmjs.com/package/yjs) — Latest version 13.6.29
- [y-partykit npm package](https://www.npmjs.com/package/y-partykit) — Latest version 0.0.33
- [y-prosemirror npm package](https://www.npmjs.com/package/y-prosemirror) — Latest version 1.3.7
- [PartyKit npm package](https://www.npmjs.com/package/partykit) — Latest version 0.0.115
- [Yjs Awareness Documentation](https://docs.yjs.dev/getting-started/adding-awareness) — Cursor awareness API
- [BlockNote Collaboration Documentation](https://www.blocknotejs.org/docs/features/collaboration) — Yjs integration
- [PartyKit y-partykit API Reference](https://docs.partykit.io/reference/y-partykit-api/) — Server and client setup
- [GitHub: cloudflare/partykit y-partyserver README](https://github.com/cloudflare/partykit/blob/main/packages/y-partyserver/README.md) — Persistence hooks
- [GitHub: RahulBadenkal/y-excalidraw](https://github.com/RahulBadenkal/y-excalidraw) — Community Excalidraw binding
- [Excalidraw Collaboration Blog](https://plus.excalidraw.com/blog/building-excalidraw-p2p-collaboration-feature) — Technical implementation
- [Cloudflare Durable Objects Free Tier](https://developers.cloudflare.com/changelog/2025-04-07-durable-objects-free-tier/) — Free tier limits
- [Cloudflare Acquires PartyKit](https://blog.cloudflare.com/cloudflare-acquires-partykit/) — Maintenance commitment

---
*Stack research for: Multiplayer cursors and real-time collaboration infrastructure*
*Researched: 2026-02-10*
