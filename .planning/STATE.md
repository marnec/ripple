# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-12)

**Core value:** Seamless integration between all workspace features — users, documents, diagrams, and tasks can reference and embed each other, creating a connected workspace rather than isolated tools.
**Current focus:** Phase 17 - Graceful Degradation

## Current Position

Phase: 17 of 17 (Graceful Degradation)
Plan: 3 of 5 in current phase
Status: In Progress
Last activity: 2026-02-13 — Completed 17-03-PLAN.md (PartyKit Alarm Handler roomId Caching)

Progress: [████████████████████░░░░░░░░] 84% (49/58 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 49
- Average duration: 3.7 min
- Total execution time: 198.8 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-projects-foundation | 4 | 14 min | 3.5 min |
| 02-basic-tasks | 4 | 19 min | 4.8 min |
| 03-kanban-board-view | 3 | 11 min | 3.7 min |
| 04-chat-to-task-integration | 2 | 7 min | 3.5 min |
| 05-document-diagram-embeds | 3 | 9.1 min | 3.0 min |
| 06-task-comments | 1 | 3 min | 3.0 min |
| 06.1-mention-people-in-task-comments | 1 | 3 min | 3.0 min |
| 07-notifications-and-polish | 2 | 4 min | 2.0 min |
| 08-emoji-reactions-foundation | 2 | 4.4 min | 2.2 min |
| 09-user-mentions-in-chat | 2 | 6.4 min | 3.2 min |
| 10-inline-reply-to | 2 | 6.6 min | 3.3 min |
| 03.1-default-taskstatus-logic | 1 | 2.5 min | 2.5 min |
| 03.2-taskstatus-per-project-scope-and-cascade-delete | 2 | 7.2 min | 3.6 min |
| 11-partykit-infrastructure-persistence | 2 | 8.6 min | 4.3 min |
| 12-document-multiplayer-cursors-yjs-migration | 2 | 8.2 min | 4.1 min |
| 13-diagram-multiplayer-cursors | 2 | 8.9 min | 4.5 min |
| 13.1-fix-deployment-pipeline | 1 | 25 min | 25 min |
| 13.2-add-document-like-collaboration-to-the-blocknote-editor-in-tasks | 2 | 9 min | 4.5 min |
| 14-protocol-foundation | 1 | 4 min | 4.0 min |
| 15-persistence-layer | 2 | 5.4 min | 2.7 min |
| 16-auth-resilience | 5 | 18.5 min | 3.7 min |
| 17-graceful-degradation | 3 | 14.0 min | 4.7 min |

**Recent Trend:**
- Last 5 plans: 5.2, 3.1, 4.5, 1.5, 3.3 min
- Trend: Consistently stable execution times (excluding deployment outlier)

*Updated: 2026-02-13*
| Phase 17 P03 | 3.3 | 1 tasks | 1 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

Recent decisions affecting v0.11 work:

**From v0.10 architecture:**
- PartyKit snapshot persistence (no write-through to Convex — content lives only in PartyKit + IndexedDB)
- One-time token auth consumed on connect (causes reconnection issues — addressed in Phase 16)
- No permission re-validation after initial connect (security gap — addressed in Phase 16)
- Legacy ProseMirror JSON content field still exists in documents table (cleanup opportunity)

**From Phase 13.2:**
- Client-side migration from Convex to Yjs on first editor load (incremental, not batch)
- Migration emptiness check prevents overwriting existing Yjs content
- clearDescription mutation called after successful migration (Yjs becomes single source of truth)
- Absolute imports (@/pages, @/lib) for collaboration components

**From Phase 14:**
- Discriminated union pattern for WebSocket messages (type field as discriminant)
- Error severity classification: terminal vs recoverable (guides retry logic in Phase 17)
- Send typed error message before WebSocket close (better error context than close reason)
- PartyKit uses @shared/* path alias (matches frontend convention)

**From Phase 13.1:**
- Separate Cloudflare tokens for Workers vs PartyKit deployment
- PartyKit CI auth via GitHub token (Clerk tokens hang)
- npm overrides instead of --legacy-peer-deps for y-excalidraw peer deps
- Committed package-lock.json for deterministic CI installs

**From Phase 15:**
- Use yjsSnapshotId field name to clarify Yjs-specific binary data
- Inline roomId parsing in HTTP actions to avoid import resolution issues
- Remove legacy diagrams.content field - Yjs is single source of truth
- Periodic save interval: 30 seconds for periodic saves while users are connected
- Disconnect debounce window: 7 seconds after last user disconnects before saving
- Cold-start loading via y-partykit load callback fetching from Convex GET endpoint
- Save failure handling: log errors but don't crash server (PartyKit storage is fallback)
- [Phase 15-02]: Periodic save interval: 30 seconds for periodic saves while users are connected
- [Phase 15-02]: Disconnect debounce window: 7 seconds after last user disconnects before saving
- [Phase 15-02]: Cold-start loading via y-partykit load callback fetching from Convex GET endpoint
- [Phase 15-02]: Save failure handling: log errors but don't crash server (PartyKit storage is fallback)
- [Phase 16-01]: Dynamic token refresh via async params function in y-partykit
- [Phase 16-01]: Connection state tracking via PartyKit setState API for per-connection userId/userName
- [Phase 16-01]: Diagram embeds show placeholder after Phase 15 content field removal
- [Phase 16-02]: Periodic permission re-validation every 30 seconds via piggyback on periodic alarm
- [Phase 16-02]: Fail-open pattern for permission checks (availability over strict security)
- [Phase 16-02]: Server-to-server auth via PARTYKIT_SECRET for permission validation endpoint
- [Phase 17-01]: 4-second connection timeout (CONNECTION_TIMEOUT = 4000) for graceful degradation
- [Phase 17-01]: IndexedDB initialization decoupled from provider lifecycle (offline-first loading)
- [Phase 17-01]: Dual-source loading pattern: editor loads when EITHER provider OR IndexedDB syncs
- [Phase 17-01]: Two-state connection indicator (connected/offline) replacing three-state design
- [Phase 17-02]: Read-only snapshot mode for cold-start (no IndexedDB cache available)
- [Phase 17-02]: ActiveUsers hidden when offline, ConnectionStatus always visible
- [Phase 17-02]: Separate SnapshotFallback component for documents to avoid conditional hook calls
- [Phase 17-02]: Inline snapshot rendering for diagrams using Excalidraw viewModeEnabled
- [Phase 16-03]: Window offline/online events supplement WebSocket-based detection (both needed for full coverage)
- [Phase 16-03]: navigator.onLine check at connect time prevents unnecessary connection attempts
- [Phase 16-03]: Diagram block click navigation works regardless of editor editable state
- [Phase 16-05]: Reconnection trigger pattern forces connection useEffect re-run on browser online event
- [Phase 17-03]: Cache roomId in PartyKit durable storage for alarm handler access (this.room.id inaccessible in alarm context)
- [Phase 17-03]: Refactor saveSnapshotToConvex and checkPermissions to accept roomId parameter instead of accessing this.room.id

### Pending Todos

None.

### Blockers/Concerns

**Known Issues (v0.11 addresses):**
- ~~Phase 14: No shared types between PartyKit and frontend~~ ✓ Resolved — shared/protocol module
- ~~Phase 15: No Yjs→Convex sync (data loss risk on PartyKit restart)~~ ✓ Resolved — periodic saves + disconnect debounce + cold-start loading
- ~~Phase 16-01: Token consumed on first connect (reconnection broken)~~ ✓ Resolved — dynamic token refresh via async params function
- ~~Phase 16-02: No permission re-validation (removed users can edit until disconnect)~~ ✓ Resolved — periodic checks every 30s with graceful disconnection
- ~~Phase 17: No graceful degradation (editors crash if PartyKit unavailable)~~ ✓ Resolved — timeout fallback + IndexedDB caching + snapshot fallback + offline UI

**Resolved from v0.10:**
- Snapshot compaction implemented (Phase 11-01)
- ProseMirror to Yjs migration complete (Phase 12-01)
- Custom inline content works with Yjs (Phase 12-01)
- y-excalidraw compatibility verified (Phase 13-01)

## Session Continuity

Last session: 2026-02-13
Stopped at: Completed 17-03-PLAN.md (PartyKit Alarm Handler roomId Caching)
Resume file: None
Next step: Continue Phase 17 execution - 2 more plans remaining (17-04, 17-05)
