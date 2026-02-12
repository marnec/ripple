# Phase 17: Graceful Degradation - Context

**Gathered:** 2026-02-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Editors remain usable when PartyKit is unavailable. Documents, diagrams, and task descriptions fall back to offline editing via IndexedDB (preferred) or read-only Convex snapshot (cold start). All three resource types get the same treatment.

</domain>

<decisions>
## Implementation Decisions

### Degradation trigger
- Quick timeout (3-5s) on initial page load before falling back
- Primary fallback source: IndexedDB (local Yjs state)
- Cold start fallback (no IndexedDB cache): load Convex snapshot
- Offline editing via Yjs CRDTs — NOT read-only mode when IndexedDB is available
- All three resource types (documents, diagrams, task descriptions) have identical offline behavior

### Offline editing experience
- Full editing supported from IndexedDB when disconnected — Yjs CRDTs handle merge on reconnect
- Slightly reduced UI when offline: hide active users panel, disable collab-only features (no cursors, no presence)
- Convex snapshot fallback (cold start, no IndexedDB): Claude's discretion on whether read-only or editable
- Same offline behavior across documents, diagrams, and task descriptions

### Status indication
- Inline indicator near editor toolbar / active users area (not a top banner)
- Minimal/neutral tone: icon change (e.g. cloud-off) — no text unless hovered
- Two states only: Connected (normal) vs Not Connected (offline icon)
- Indicator always visible — small green dot or similar when connected, offline icon when not
- Snapshot fallback (read-only cold start) messaging: Claude's discretion on whether to distinguish from regular offline

### Recovery behavior
- Auto-reconnect when PartyKit comes back (y-partykit handles this)
- Auto-transition from read-only snapshot to live editor when connection restores
- Offline edit merge notification: Claude's discretion (silent merge vs "Changes synced" toast)
- IndexedDB kept continuously in sync during connected sessions (not just on disconnect)
- Time-limited offline edits: discard stale IndexedDB changes after a reasonable period (Claude picks duration)

### Claude's Discretion
- Convex snapshot cold start: read-only vs editable (based on merge complexity/safety)
- Snapshot fallback status messaging: whether to show "Viewing saved version" vs same offline icon
- Merge notification UX: silent merge vs brief toast
- IndexedDB staleness threshold duration
- Exact timeout value within 3-5s range
- Loading/transition animations

</decisions>

<specifics>
## Specific Ideas

- User's insight: "Is it really necessary to have read-only mode with IndexedDB?" — shifted the entire approach from read-only fallback to offline-capable editing
- Yjs CRDTs are the key enabler — they handle conflict-free merging of offline edits automatically
- The experience should feel like the editor "just works" whether online or offline, with only subtle visual cues about connection state

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 17-graceful-degradation*
*Context gathered: 2026-02-12*
