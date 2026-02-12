# Phase 15: Persistence Layer - Context

**Gathered:** 2026-02-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Full Yjs state persists to Convex when all users disconnect. All three collaborative resource types (documents, diagrams, task descriptions) save their Yjs binary state to Convex file storage, and cold-start from Convex snapshots when no active PartyKit room exists. This ensures data durability across PartyKit server restarts.

</domain>

<decisions>
## Implementation Decisions

### Save trigger & timing
- Save on two triggers: periodic (every 30 seconds while room has active connections) AND on last-user disconnect
- Short debounce (5-10s) on last-user disconnect before saving — avoids unnecessary writes on quick tab refresh/reopen
- Periodic saves prevent data loss when users leave tabs open for hours and browser crashes
- PartyKit calls a Convex HTTP endpoint to save snapshots (server-to-server, not client-driven)
- On save failure: log error and rely on PartyKit's Durable Object storage as fallback. No retry logic — accept temporary risk

### Snapshot format & storage
- Yjs binary snapshots stored in Convex file storage (blob storage via `_storage`)
- Reference via `yjsSnapshotId: v.optional(v.id("_storage"))` field directly on resource tables (documents, diagrams, tasks)
- Overwrite only — no version history. Each save replaces the previous snapshot
- Remove legacy content fields: `diagrams.content` (old Excalidraw JSON) and `documents.content` (old ProseMirror JSON)
- All three resource tables use the same field name: `yjsSnapshotId`

### Load behavior & cold start
- Load chain approach: Claude's Discretion (server-side vs client-side seed)
- Loading UX: keep existing behavior — no UX changes for this phase
- Conflict resolution (PartyKit storage vs Convex snapshot): Claude's Discretion
- IndexedDB serves dual role: performance cache for fast repeat visits AND last-resort fallback if both PartyKit and Convex are empty/unavailable

### Multi-resource consistency
- Same persistence mechanism for all three resource types (documents, diagrams, task descriptions)
- All three ship in the same plan — no phased rollout
- Uniform field naming: `yjsSnapshotId` on all three tables
- PartyKit-to-Convex save endpoint authenticated via shared secret / API key

### Claude's Discretion
- Cold-start load chain architecture (server-side PartyKit fetch vs client-side seed)
- Conflict resolution when both PartyKit storage and Convex snapshot exist
- Debounce window exact duration (within 5-10s range)
- Periodic save implementation (alarm vs interval)

</decisions>

<specifics>
## Specific Ideas

- Periodic saves motivated by "users leave a tab open for hours" scenario — browser crash would lose all work without periodic persistence
- Server-to-server pattern: PartyKit POSTs snapshot to Convex HTTP endpoint (matches existing collaboration/verify pattern)
- Shared secret auth between PartyKit and Convex for the save endpoint

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 15-persistence-layer*
*Context gathered: 2026-02-12*
