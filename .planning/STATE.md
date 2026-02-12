# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-10)

**Core value:** Seamless integration between all workspace features — users, documents, diagrams, and tasks can reference and embed each other, creating a connected workspace rather than isolated tools.
**Current focus:** v0.10 Multiplayer Cursors & Collaboration

## Current Position

Phase: 13.2 - Add Document-Like Collaboration to the BlockNote Editor in Tasks
Plan: 02 of 02
Status: Complete
Progress: [██████████] 100%
Last activity: 2026-02-12 — Completed 13.2-02-PLAN.md: Task collaborative editing UI with Yjs migration

## Performance Metrics

**Velocity:**
- Total plans completed: 38
- Average duration: 3.7 min
- Total execution time: 156.9 min

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

## Accumulated Context

### Decisions

Recent decisions from Phase 13.2-02:
- Client-side migration from Convex to Yjs happens on first editor load (incremental, not batch)
- Migration emptiness check prevents overwriting existing Yjs content
- clearDescription mutation called after successful migration (Yjs becomes single source of truth)
- Absolute imports (@/pages, @/lib) used for collaboration components across directories

Recent decisions from Phase 13.2-01:
- Task collaboration validates project membership (tasks inherit access from their project)
- useDocumentCollaboration defaults resourceType to "doc" for backward compatibility
- IndexedDB cache keys use resource type prefix (task-{id}, doc-{id}) to prevent collisions
- clearDescription mutation provided for post-migration Convex cleanup

Recent decisions from Phase 13.1-01:
- Separate Cloudflare tokens: CLOUDFLARE_WORKERS_API_TOKEN for wrangler, CLOUDFLARE_API_TOKEN for RTK
- PartyKit CI auth via GitHub token (Clerk tokens hang — tries browser-based session refresh)
- npm overrides instead of --legacy-peer-deps for y-excalidraw peer dep resolution
- Committed package-lock.json for deterministic CI installs
- Relaxed health checks for WebSocket servers and SPA redirects

Recent decisions from Phase 13-02:
- No off-screen cursor indicators (cursors hidden when outside viewport per user decision)
- Lock badges always visible (not hover-only) for simplicity in typical 1-3 locked elements scenario
- Pointer tracking via pointermove event on excalidraw-wrapper (not via Excalidraw onChange)
- ActiveUsers onUserClick prop added as backwards-compatible enhancement (documents don't use it)
- Removed all Convex presence system (useEnhancedPresence, FacePile) in favor of Yjs Awareness

Recent decisions from Phase 13-01:
- Installed y-excalidraw with --legacy-peer-deps due to Excalidraw 0.18.0 vs ^0.17.6 peer dependency mismatch
- Store canvas coordinates in awareness (not screen coords) to prevent cross-viewport rendering issues
- ExcalidrawBinding creation deferred to component (requires excalidrawAPI available after mount)
- Reused Phase 12 timeouts: 10s stale client removal, 30s idle pointer detection

Recent decisions from Phase 12-02:
- BlockNote handles cursor rendering automatically via y-prosemirror (no custom overlay needed)
- 10s stale client removal in avatar stack (more aggressive than 30s in-editor timeout)
- Simple sync state heuristic with 500ms debounce (Yjs syncs near-instantly)
- Removed old Convex presence system from DocumentEditor (Yjs Awareness more accurate)

Recent decisions from Phase 12-01:
- Complete removal of ProseMirror Sync (clean break to Yjs, no hybrid state)
- IndexedDB persistence from day one (prevents data loss, improves load performance)
- Singleton ColorHash instance (consistent configuration for documents and future diagrams)
- Schema passed as parameter to collaboration hook (enables custom blocks with Yjs)

Recent decisions from Phase 11-02:
- One-time token authentication for PartyKit (simpler than JWT, leverages Convex built-in auth)
- Auth verification in PartyKit onConnect handler (y-partykit uses onConnect function pattern)
- Complete removal of RTK cursor tracking system (Phase 12 will use Yjs Awareness-based cursors)

Recent decisions from Phase 11-01:
- Snapshot mode persistence for Yjs documents (automatic compaction on last client disconnect)
- y-partykit onConnect handler pattern (y-partykit exports onConnect function, not YPartyKitServer class)
- Environment variables deferred to Plan 02 (PartyKit define field doesn't support env: prefix)

Recent decisions from v0.10 roadmap:
- Phase 11: PartyKit infrastructure must be deployed before any cursor work (blocks all other phases)
- Phase 12: Document cursors + full Yjs migration combined (BlockNote has first-class Yjs support, proven path)
- Phase 13: Diagram multiplayer isolated (y-excalidraw is community library, higher risk)
- Snapshot compaction implemented in Phase 11 (research pitfall: prevents unbounded Yjs history growth)
- User colors established in Phase 12 and reused in Phase 13 (AWARE-03)

Recent decisions from Phase 03.2:
- TaskStatuses migrated from workspace-scoped to project-scoped (each project independent)
- Legacy fields kept optional in schema for backward compatibility during migration
- Cascade-to-default on status deletion: tasks move to project default instead of blocking
- Full cascade delete on project removal: taskComments → tasks → taskStatuses → project
- Frontend uses project-scoped taskStatus APIs (listByProject)
- Cascade delete UX messaging informs users tasks move to default status

Recent decisions from Phase 03.1:
- Default statuses (Todo, In Progress, Done) seeded at project creation (workspace-scoped, idempotent)
- One-way completed sync: moving TO Done sets completed=true, moving OUT does not reset
- User must explicitly uncomplete tasks that move out of Done status

All decisions logged in PROJECT.md Key Decisions table.

### Roadmap Evolution

- Phase 13.2 inserted after Phase 13: add document-like collaboration to the blocknote editor in tasks (URGENT)
- Phase 13.1 inserted after Phase 13: Fix deployment pipeline and environment configuration (URGENT)
- v0.10 milestone started at Phase 11 (continues from v0.9)
- Phase 6.1 inserted after Phase 6: Mention people in task comments (URGENT)
- v0.9 milestone started at Phase 08 (continues from v0.8)
- Phase 03.1 inserted after Phase 03: default taskStatus logic (URGENT)
- Phase 03.2 inserted after Phase 03: taskStatus per project scope and cascade delete (URGENT)

### Pending Todos

None.

### Blockers/Concerns

Research notes for v0.10:
- INFRA-04 (snapshot compaction): ✅ RESOLVED - Implemented in Phase 11-01
- DCOL-02 (ProseMirror to Yjs migration): ⚠️ FOLLOW-UP NEEDED - Migration script required if production has existing documents
- DCOL-03 (custom inline content with Yjs): ✅ RESOLVED - Verified in Phase 12-01, custom blocks work correctly
- DIAG-03 (y-excalidraw): ✅ RESOLVED - Installed with --legacy-peer-deps for Excalidraw 0.18.0 compatibility, build/lint pass
- Phase 12 combines cursors + full Yjs migration: ✅ COMPLETE - All plans executed, Yjs collaboration + cursor awareness live

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | Fix Block doesn't have id error when clicking on a task | 2026-02-10 | 96bdc3a | [1-fix-block-doesn-t-have-id-error-when-cli](./quick/1-fix-block-doesn-t-have-id-error-when-cli/) |

## Session Continuity

Last session: 2026-02-12
Stopped at: Completed 13.2-02-PLAN.md (Task collaborative editing UI) - Phase 13.2 complete (2 of 2 plans)
Resume file: None
Next step: Phase 13.2 complete - proceed to next roadmap phase

Config:
{
  "mode": "yolo",
  "depth": "standard",
  "parallelization": true,
  "commit_docs": true,
  "model_profile": "balanced",
  "workflow": {
    "research": true,
    "plan_check": true,
    "verifier": false
  }
}
