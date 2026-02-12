# Phase 14: Protocol Foundation - Context

**Gathered:** 2026-02-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Type-safe contract between PartyKit server and frontend clients. Shared TypeScript types for all WebSocket messages (auth, sync, cursor awareness, errors) with compile-time and runtime validation. No new features — this formalizes the existing communication into a typed protocol.

</domain>

<decisions>
## Implementation Decisions

### Protocol scope
- Forward-looking: define message types for current functionality AND anticipated phases 15-17 (persistence sync, token refresh, degradation signals) — even if handlers aren't built yet
- Unified protocol: one set of message types shared across all room types (documents, diagrams, tasks). Resource-specific data goes in payload fields
- Types live in existing `shared/` directory (alongside enums/roles), not a new package

### Error contract
- String identifiers for error codes (e.g., `'AUTH_EXPIRED'`, `'ROOM_NOT_FOUND'`) — self-documenting, easy to pattern match
- Code only, no human-readable message field. Client maps codes to display messages
- Error visibility and recoverability classification are Claude's discretion

### Versioning strategy
- Every message type documented with JSDoc comments explaining purpose, sender, and expected behavior
- Runtime validation using a schema library (e.g., Zod) to parse incoming messages — catches malformed messages at runtime, not just compile-time
- Protocol version field and breaking-change policy are Claude's discretion

### Claude's Discretion
- Whether to centralize room ID formats and connection URL construction in shared types (or leave in place)
- Error visibility to users (silent recovery vs subtle indicator based on severity)
- Whether errors should be typed as recoverable vs terminal in the type system
- Protocol versioning field and breaking-change policy
- Specific schema validation library choice

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-protocol-foundation*
*Context gathered: 2026-02-12*
