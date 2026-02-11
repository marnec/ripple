# Phase 11: PartyKit Infrastructure & Persistence - Context

**Gathered:** 2026-02-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Deploy PartyKit server on Cloudflare with Yjs persistence (Durable Objects snapshot mode), snapshot compaction, and Convex-integrated authentication. This phase delivers the WebSocket infrastructure that Phase 12 (documents) and Phase 13 (diagrams) build on. Also removes the existing RTK-based cursor tracking code (cursorSessions, use-cursor-tracking) since it's being replaced.

</domain>

<decisions>
## Implementation Decisions

### Provider Choice
- PartyKit confirmed after evaluating y-webrtc + Cloudflare TURN (no persistence, P2P mesh doesn't scale, signaling server still needed) and Liveblocks (10 connections/room on free tier, vendor lock-in, higher cost)
- PartyKit runs on Cloudflare Durable Objects — aligns with existing Cloudflare usage (RTK for video calls)

### Auth Integration
- Claude's discretion on auth mechanism (JWT vs Convex token passthrough — pick what fits best)
- Document-level permissions enforced: PartyKit verifies the connecting user has access to the specific document/diagram, not just workspace membership
- Permission revocation: lazy — current session stays active, rejected on next reconnect (no real-time revocation)
- Room naming: type-prefixed — `doc-{documentId}`, `diagram-{diagramId}`

### Persistence & Backup
- Claude's discretion on persistence strategy (Durable Objects snapshot mode is the baseline; Convex backup approach is flexible)

### Project Structure & Dev Workflow
- PartyKit server code lives inside the monorepo: new `/partykit` directory at project root alongside `/src` and `/convex`
- Local dev: `npm run dev` starts Vite + Convex + PartyKit dev server (3 processes, single command)
- Production deploy: both `npm run deploy` script and CI auto-deploy on push to main
- RTK cursor cleanup: remove cursorSessions table/functions and use-cursor-tracking hook in this phase (don't wait for Phase 12)

### Claude's Discretion
- Auth mechanism choice (JWT vs token passthrough)
- Convex backup strategy and frequency
- Snapshot compaction approach and scheduling
- PartyKit server file structure within `/partykit`
- How to wire PartyKit dev server into existing concurrently-based dev script

</decisions>

<specifics>
## Specific Ideas

- User evaluated y-webrtc (P2P, no persistence, ~20-35 peer cap), Liveblocks (managed but 10 conn/room free tier, $30/mo pro), and PartyKit (Cloudflare DO, no rate limits, $0-5/mo) — detailed analysis in conversation
- Existing RTK cursor tracking in `use-cursor-tracking.ts` uses `broadcastMessage()` with 200ms throttle but hits RTK's 5 msg/s rate limit — this is the motivation for moving to PartyKit/Yjs Awareness
- Excalidraw collaboration: neither PartyKit nor Liveblocks has official support — both rely on community y-excalidraw binding
- BlockNote collaboration docs show y-webrtc as example provider, but any Yjs provider works (y-partykit is documented by BlockNote)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-partykit-infrastructure-persistence*
*Context gathered: 2026-02-11*
