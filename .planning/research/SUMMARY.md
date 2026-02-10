# Research Summary: Multiplayer Cursors & Real-Time Collaboration

**Domain:** Multiplayer cursor awareness and collaborative editing infrastructure
**Researched:** 2026-02-10
**Overall confidence:** HIGH

## Executive Summary

PartyKit (acquired by Cloudflare) with Yjs provides the optimal stack for adding multiplayer cursors and real-time collaboration to Ripple. The combination runs serverless on Cloudflare Workers/Durable Objects (already in project infrastructure), avoids the 5 events/s rate limit that killed the previous Cloudflare RTK attempt, and integrates cleanly with BlockNote's first-class Yjs support and Excalidraw via a community binding.

**Key Decision:** Keep existing @convex-dev/prosemirror-sync for BlockNote document content in Phase 1, add Yjs ONLY for cursor awareness. This avoids data migration risk while delivering immediate cursor tracking value. Full Yjs migration can be evaluated in a later phase if unified collaboration sync proves valuable.

**Critical Finding:** y-excalidraw is a community library without an official npm package (must vendor from GitHub). It's the only viable path for Excalidraw multiplayer without running a Socket.IO server. Risk acceptable given small scope (binds Y.Array to elements).

**Integration Strategy:** PartyKit snapshot mode (built-in Durable Objects persistence) handles all real-time sync. Convex remains source of truth for non-collaborative data (permissions, workspace settings). Optional: periodic Convex backup via PartyKit's onSave() hook for export/audit purposes.

## Key Findings

**Stack:** Yjs 13.6.29 (CRDT), y-partykit 0.0.33 (WebSocket provider), y-prosemirror 1.3.7 (BlockNote binding), y-excalidraw (vendor from GitHub for Excalidraw).

**Architecture:** Dual-system approach - ProseMirror Sync (documents content) + Yjs Awareness (cursors only) minimizes migration risk. PartyKit runs on Cloudflare edge (same infra as Ripple frontend via Wrangler), hibernation API reduces costs vs always-on WebSockets.

**Critical pitfall:** Don't mix Convex optimistic updates with Yjs CRDTs on same data - use Convex for infrequent updates (settings, permissions), Yjs for high-frequency collaboration (cursors, content). Previous RTK failure was rate limiting (5 events/s), not fundamental architecture issue - Yjs Awareness has no such limit.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Phase 1: PartyKit Infrastructure + Document Cursors**
   - Addresses: PartyKit server setup, Yjs Awareness for BlockNote documents
   - Avoids: Data migration (keeps ProseMirror Sync), full Excalidraw refactor
   - Delivers: Immediate cursor tracking in documents with minimal risk

2. **Phase 2: Excalidraw Multiplayer**
   - Addresses: y-excalidraw vendor integration, diagram cursor awareness + element sync
   - Avoids: Shared rooms (separate PartyKit room per diagram in v1)
   - Delivers: True multiplayer diagrams, replaces manual reconcileElements

3. **Phase 3 (Optional): Full Yjs Migration**
   - Addresses: Data migration from ProseMirror Sync to Yjs, unified sync
   - Avoids: Dual systems complexity, potential offline editing improvements
   - Delivers: Cleaner architecture if collaboration features expand

**Phase ordering rationale:**
- Documents first (higher usage than diagrams, BlockNote has official Yjs integration)
- Cursors-only approach proves Yjs/PartyKit infrastructure before committing to full migration
- Excalidraw second (lower usage, community library risk isolated to Phase 2)
- Full migration optional (only if Phase 1/2 usage justifies consolidation)

**Research flags for phases:**
- Phase 1: Standard implementation, unlikely to need deeper research
- Phase 2: Likely needs deeper research on y-excalidraw vendoring, element-level sync semantics
- Phase 3: Needs research on ProseMirror JSON → Yjs migration if pursued

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Yjs is industry standard (fastest CRDT), PartyKit officially maintained by Cloudflare, versions verified on npm |
| PartyKit Integration | HIGH | Official docs for Convex persistence hooks, snapshot mode built-in, Cloudflare edge deployment via existing Wrangler |
| BlockNote Yjs Support | HIGH | Official BlockNote collaboration docs, y-prosemirror is canonical binding, proven integration path |
| Excalidraw Binding | MEDIUM | y-excalidraw is community library (82 commits, 33 stars), no official npm package, needs vendoring. Functional but maintenance risk. |
| Dual System Approach | HIGH | Keeps ProseMirror Sync working, adds Yjs only for cursors, no data migration required, clear separation of concerns |
| RTK vs PartyKit Comparison | HIGH | RTK 5 events/s limit verified in existing code (use-cursor-tracking.ts throttles to 200ms = 5/s theoretical max). PartyKit uses Durable Objects WebSockets (no rate limit). |

## Gaps to Address

**Areas where research was inconclusive:**
- **y-excalidraw maintenance status:** GitHub repo active but no recent releases, no npm package. Need to evaluate fork vs vendor decision in Phase 2.
- **Convex ↔ PartyKit persistence patterns:** Official docs show both snapshot mode and external storage hooks, but no Convex-specific examples. Implementation strategy clear but untested.
- **Migration path from ProseMirror Sync to Yjs:** If Phase 3 pursued, need research on data transformation (ProseMirror JSON → Yjs Y.XmlFragment). BlockNote provides server-side conversion utils but migration strategy needs design.

**Topics needing phase-specific research later:**
- **Phase 2:** y-excalidraw element-level sync semantics (how it handles concurrent edits, version resolution vs Yjs CRDT)
- **Phase 2:** Excalidraw reconcileElements removal (ensure y-excalidraw fully replaces manual conflict resolution)
- **Phase 3 (if pursued):** Migration script for existing documents (ProseMirror JSON in Convex → Yjs updates in PartyKit/Convex)
- **Phase 3 (if pursued):** Rollback strategy if Yjs migration causes issues (how to preserve ProseMirror Sync data during transition)

**Validation needed:**
- PartyKit free tier limits for realistic usage (5 GB Durable Objects storage, request limits per day - need load testing)
- y-excalidraw with Excalidraw 0.18.0 compatibility (repo doesn't specify supported version)
- Yjs Awareness performance with 10+ simultaneous cursors (no documented limits but untested in Ripple context)

## Sources

All research verified via:
- **Package versions:** npm registry (yjs 13.6.29, y-partykit 0.0.33, y-prosemirror 1.3.7, partykit 0.0.115)
- **Official documentation:** Yjs docs (awareness API), BlockNote docs (collaboration), PartyKit docs (y-partykit API, persistence)
- **Cloudflare official:** Durable Objects pricing/limits, PartyKit acquisition announcement
- **Community resources:** y-excalidraw GitHub (API understanding), Excalidraw collaboration blog (architecture patterns)

See STACK.md for full source list with URLs.

---
*Research summary for: Multiplayer cursors and real-time collaboration infrastructure*
*Researched: 2026-02-10*
