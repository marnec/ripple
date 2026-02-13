# Roadmap: Ripple

## Milestones

- ✅ **v0.8 Task Management** - Phases 01-07 (shipped 2026-02-07)
- ✅ **v0.9 Chat Features** - Phases 08-10 (shipped 2026-02-07)
- ✅ **v0.10 Multiplayer Cursors & Collaboration** - Phases 11-13 (shipped 2026-02-11)
- 🚧 **v0.11 Architectural Risk Mitigation** - Phases 14-17 (in progress)

## Overview

v0.9 brings Ripple's chat interactions up to modern standards with emoji reactions, @user mentions, and inline reply-to. These three features transform chat from basic messaging into a rich communication layer comparable to Slack and Teams, completing the core workspace collaboration toolkit.

v0.10 adds real-time multiplayer cursor awareness to documents and diagrams, backed by WebSocket infrastructure (PartyKit + Yjs). Users will see each other's cursor positions and selections in real-time, dramatically improving collaborative editing awareness. The infrastructure evaluation also explores migrating from ProseMirror Sync to Yjs for unified collaboration architecture.

v0.11 hardens the PartyKit/Convex split persistence architecture — ensuring data durability, fixing auth gaps, and adding graceful degradation so the collaboration layer is production-ready.

## Phases

<details>
<summary>✅ v0.8 Task Management (Phases 01-07) - SHIPPED 2026-02-07</summary>

### Phase 01: Projects Foundation
**Goal**: Workspace-level project containers with membership-based access
**Plans**: 3 plans

Plans:
- [x] 01-01: Schema and mutations for projects
- [x] 01-02: Project UI and sidebar integration
- [x] 01-03: Auto-create project channel

### Phase 02: Basic Tasks
**Goal**: CRUD operations for tasks with essential properties
**Plans**: 4 plans

Plans:
- [x] 02-01: Task schema and mutations
- [x] 02-02: Task creation UI
- [x] 02-03: Task detail sheet
- [x] 02-04: Task list view

### Phase 03: Kanban Board View
**Goal**: Drag-drop kanban board with real-time updates
**Plans**: 3 plans

Plans:
- [x] 03-01: Board schema and fractional indexing
- [x] 03-02: Column and card components
- [x] 03-03: Drag-drop with optimistic updates

### Phase 03.1: default taskStatus logic (INSERTED)

**Goal:** Seed default statuses at project creation, auto-assign default status to new tasks, enforce one-way completed sync
**Depends on:** Phase 03
**Plans:** 1 plan

Plans:
- [x] 03.1-01-PLAN.md — Backend status seeding in projects.create, simplified task default status, one-way completed sync

### Phase 03.2: taskStatus per project scope and cascade delete (INSERTED)

**Goal:** Scope taskStatuses to individual projects (not workspace-level) and implement cascade delete when a taskStatus is removed, plus cascade delete tasks when a project is removed
**Depends on:** Phase 03.1
**Plans:** 2 plans

Plans:
- [x] 03.2-01-PLAN.md — Schema migration and project-scoped taskStatuses backend with cascade delete
- [x] 03.2-02-PLAN.md — Frontend updates for project-scoped status APIs and cascade delete UX

### Phase 04: Chat-to-Task Integration
**Goal**: Convert chat messages to tasks with context
**Plans**: 2 plans

Plans:
- [x] 04-01: Message context menu with create task
- [x] 04-02: Task creation modal prefill

### Phase 05: Document-Diagram Embeds
**Goal**: Embed documents, diagrams, users, projects in task descriptions
**Plans**: 3 plans

Plans:
- [x] 05-01: Custom BlockNote inline content specs
- [x] 05-02: Embed picker UI
- [x] 05-03: Render embedded content

### Phase 06: Task Comments
**Goal**: Discussion threads on tasks
**Plans**: 1 plan

Plans:
- [x] 06-01: Comments schema, UI, real-time updates

### Phase 06.1: Mention People in Task Comments (INSERTED)
**Goal**: @mention workspace members in task comments with notifications
**Plans**: 1 plan

Plans:
- [x] 06.1-01: User mention BlockNote inline content with push notifications

### Phase 07: Notifications and Polish
**Goal**: Task assignment and @mention notifications
**Plans**: 2 plans

Plans:
- [x] 07-01: Push notification infrastructure
- [x] 07-02: Wire notification triggers

</details>

<details>
<summary>✅ v0.9 Chat Features (Phases 08-10) - SHIPPED 2026-02-07</summary>

**Milestone Goal:** Enrich chat with @user mentions, emoji reactions, and inline reply-to — bringing chat interaction quality closer to Slack/Teams.

### Phase 08: Emoji Reactions Foundation
**Goal**: Users can react to messages with emoji (Slack-style pills with counts)
**Depends on**: Phase 07
**Requirements**: REACT-01, REACT-02, REACT-03, REACT-04, REACT-05, REACT-06
**Success Criteria** (what must be TRUE):
  1. User can click emoji picker on any message to select and add a reaction
  2. Reactions display as aggregated pills below message showing emoji and count (e.g., "👍 3")
  3. User can click an existing reaction pill to toggle their own reaction on/off (highlighted when user has reacted)
  4. Hovering a reaction pill shows tooltip listing all users who reacted with that emoji
  5. Multiple different emoji reactions work on the same message
  6. Reactions update in real-time across all connected clients (other users see new reactions immediately)
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md — Backend schema and CRUD (messageReactions table, toggle mutation, aggregation query)
- [x] 08-02-PLAN.md — Frontend reaction UI (emoji picker, pills, tooltips, Message.tsx integration)

### Phase 09: @User Mentions in Chat
**Goal**: Users can @mention workspace members in chat with autocomplete and notifications
**Depends on**: Phase 08
**Requirements**: MENT-01, MENT-02, MENT-03, MENT-04, MENT-05
**Success Criteria** (what must be TRUE):
  1. User can type @ in chat composer and see autocomplete dropdown of workspace members
  2. User can select a member from autocomplete (keyboard nav or click) to insert styled @mention chip
  3. @mention chips render with user's name in both composer and sent messages (distinct from plain text)
  4. Mentioned users receive push notification when message is sent ("Alice mentioned you in #general")
  5. Self-mentions are filtered (mentioning yourself does not create a notification)
**Plans**: 2 plans

Plans:
- [x] 09-01-PLAN.md — Frontend @mention autocomplete and rendering (composer schema, @ trigger, message renderer)
- [x] 09-02-PLAN.md — Backend chat notifications and mention wiring (chatNotifications action, messages.send extraction)

### Phase 10: Inline Reply-To
**Goal**: Users can reply to specific messages with quoted preview in chat flow
**Depends on**: Phase 09
**Requirements**: REPLY-01, REPLY-02, REPLY-03, REPLY-04
**Success Criteria** (what must be TRUE):
  1. User can click "Reply" action on any message to enter reply mode in composer
  2. Reply mode shows compact quoted preview of original message in composer with cancel button
  3. Submitted reply displays in normal chat flow with compact quoted preview above it (showing author and truncated text)
  4. If original message is deleted after reply was sent, reply shows "[Message deleted]" placeholder gracefully (no broken references)
**Plans**: 2 plans

Plans:
- [x] 10-01-PLAN.md — Backend schema and query enrichment (replyToId field, messages.send update, messages.list parent info)
- [x] 10-02-PLAN.md — Frontend reply mode UI (ChatContext reply state, MessageQuotePreview, Message reply action + display, MessageComposer preview)

</details>

<details>
<summary>✅ v0.10 Multiplayer Cursors & Collaboration - SHIPPED 2026-02-11</summary>

**Milestone Goal:** Add real-time multiplayer cursor awareness to documents and diagrams, backed by proper WebSocket infrastructure — and evaluate whether the new infra should also replace/improve the existing collaborative editing approach.

### Phase 11: PartyKit Infrastructure & Persistence
**Goal**: Deploy PartyKit server with Yjs persistence and snapshot compaction
**Depends on**: Phase 10
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04
**Success Criteria** (what must be TRUE):
  1. PartyKit server is deployed on Cloudflare and accessible from Ripple frontend
  2. Frontend can authenticate to PartyKit rooms using Convex user identity (no unauthorized access)
  3. Yjs document state persists across PartyKit server restarts (snapshot mode using Durable Objects)
  4. Snapshot compaction runs automatically to prevent unbounded Yjs update history growth (storage and performance remain stable over time)
**Plans**: 2 plans

Plans:
- [x] 11-01-PLAN.md — PartyKit server setup with Yjs snapshot persistence and dev workflow
- [x] 11-02-PLAN.md — Auth integration, frontend useYjsProvider hook, and RTK cursor cleanup

### Phase 12: Document Multiplayer Cursors & Yjs Migration
**Goal**: Real-time cursor awareness and Yjs-based collaboration for BlockNote documents
**Depends on**: Phase 11
**Requirements**: DCUR-01, DCUR-02, DCUR-03, DCUR-04, DCOL-01, DCOL-02, DCOL-03, DCOL-04, AWARE-01, AWARE-03
**Success Criteria** (what must be TRUE):
  1. User can see other users' cursor positions in real-time in BlockNote documents (position updates appear instantly, sub-100ms latency)
  2. User can see other users' text selection ranges highlighted with user-specific colors
  3. Each user's cursor displays a colored label with their display name (label follows cursor movement)
  4. BlockNote document content syncs via Yjs CRDTs (replacing ProseMirror Sync), with concurrent edits merging automatically
  5. Existing documents are migrated from ProseMirror JSON to Yjs format without data loss (migration script handles all existing docs)
  6. Custom BlockNote inline content types (diagrams, documents, users, projects) continue to work with Yjs sync (no regressions)
  7. Document content persists in Yjs binary format with Convex backup (documents can be restored from Convex if PartyKit state is lost)
  8. User can see a list of active users currently viewing the same document (avatar list or similar UI)
  9. User colors are consistent per user across all documents and diagrams (same user always gets same color)
**Plans**: 2 plans

Plans:
- [x] 12-01-PLAN.md — ProseMirror Sync removal, Yjs dependencies, and BlockNote Yjs collaboration rewrite
- [x] 12-02-PLAN.md — Cursor awareness UI, active users avatar stack, and connection status indicators

### Phase 13: Diagram Multiplayer Cursors
**Goal**: Real-time cursor awareness and element sync for Excalidraw diagrams
**Depends on**: Phase 12
**Requirements**: DIAG-01, DIAG-02, DIAG-03, DIAG-04, AWARE-02
**Success Criteria** (what must be TRUE):
  1. User can see other users' pointer positions in real-time in Excalidraw diagrams (pointer updates appear instantly)
  2. Each user's pointer displays a colored label with their display name (consistent with document cursor colors)
  3. Excalidraw element changes (drawing, moving, editing) sync in real-time between users (no manual reconcileElements needed)
  4. Existing diagrams remain compatible with new multiplayer infrastructure (no migration-related breakage)
  5. User can see a list of active users currently viewing the same diagram (avatar list or similar UI)
**Plans**: 2 plans

Plans:
- [x] 13-01-PLAN.md — Install y-excalidraw, canvas coordinate utilities, diagram collaboration and cursor awareness hooks
- [x] 13-02-PLAN.md — Cursor overlay UI, lock indicators, ExcalidrawEditor rewrite, DiagramPage multiplayer integration

### Phase 13.1: Fix deployment pipeline and environment configuration (INSERTED)

**Goal:** Create CI/CD pipeline (GitHub Actions) for sequential multi-service deployment (Convex, PartyKit, Cloudflare Workers), document all environment variables, and enable reliable production deployments
**Depends on:** Phase 13
**Plans:** 1 plan

Plans:
- [x] 13.1-01-PLAN.md — Environment config (.env.example, .gitignore) and GitHub Actions deployment workflow

### Phase 13.2: add document-like collaboration to the blocknote editor in tasks (INSERTED)

**Goal:** Add real-time collaborative Yjs-based editing to task descriptions, reusing PartyKit/Yjs infrastructure from Phases 11-13, with live cursors, active users UI, and migration from Convex-stored descriptions
**Depends on:** Phase 13
**Plans:** 2 plans

Plans:
- [x] 13.2-01-PLAN.md — Backend task collaboration tokens, generalize useDocumentCollaboration hook, clearDescription mutation
- [x] 13.2-02-PLAN.md — Rewrite useTaskDetail for Yjs collaboration, add ActiveUsers/ConnectionStatus to sheet and full-page views

</details>

### v0.11 Architectural Risk Mitigation (In Progress)

**Milestone Goal:** Harden the PartyKit/Convex split persistence architecture — ensure data durability, fix auth gaps, and add graceful degradation so the collaboration layer is production-ready.

#### Phase 14: Protocol Foundation ✓
**Goal**: Type-safe contract between PartyKit server and frontend clients
**Depends on**: Phase 13.2
**Requirements**: OPS-02
**Success Criteria** (what must be TRUE):
  1. Shared TypeScript types exist for all PartyKit WebSocket messages (auth, sync events, errors)
  2. Frontend and PartyKit server import types from a shared module (no duplicate type definitions)
  3. Compile-time type checking catches protocol mismatches between client and server
**Plans**: 1 plan

Plans:
- [x] 14-01-PLAN.md — Shared protocol types, Zod schemas, error codes, and PartyKit/frontend integration

#### Phase 15: Persistence Layer ✓
**Goal**: Full Yjs state persists to Convex when all users disconnect
**Depends on**: Phase 14
**Requirements**: PERSIST-01, PERSIST-02, PERSIST-03
**Success Criteria** (what must be TRUE):
  1. When the last user closes a document, the full Yjs state saves to Convex as a binary snapshot
  2. When a user opens a document with no active PartyKit state, the editor loads content from the Convex snapshot
  3. User can recover full document content from Convex after a PartyKit server restart (no data loss)
  4. Same persistence behavior works for diagrams and task descriptions (all three resource types)
**Plans**: 2 plans

Plans:
- [x] 15-01-PLAN.md -- Convex schema (yjsSnapshotId fields), snapshot mutations, and HTTP save/load endpoints
- [x] 15-02-PLAN.md -- PartyKit periodic saves, disconnect debounce, cold-start loading from Convex snapshots

#### Phase 16: Auth Resilience
**Goal**: WebSocket connections survive token expiration and permission changes
**Depends on**: Phase 15
**Requirements**: AUTH-01, AUTH-02
**Success Criteria** (what must be TRUE):
  1. When a WebSocket connection drops, the collaboration provider automatically reconnects without requiring page reload
  2. When a user's membership is revoked in Convex, their PartyKit connection terminates within 60 seconds
  3. User stays connected during extended editing sessions (beyond initial token expiration)
**Plans**: 5 plans

Plans:
- [x] 16-01-PLAN.md -- Token refresh and reconnection (dynamic params function, per-connection user state)
- [x] 16-02-PLAN.md -- Permission re-validation (checkAccess endpoint, periodic membership checks, permission_revoked handler)
- [x] 16-03-PLAN.md -- Gap closure: connection indicator offline detection and DiagramBlock click-to-navigate
- [x] 16-04-PLAN.md -- Gap closure: SVG preview storage and rendering for diagram embeds
- [x] 16-05-PLAN.md -- Gap closure: reconnect provider on browser online event recovery

#### Phase 17: Graceful Degradation
**Goal**: Editors remain usable when PartyKit is unavailable
**Depends on**: Phase 16
**Requirements**: OPS-01
**Success Criteria** (what must be TRUE):
  1. When PartyKit is unreachable, document editor shows read-only mode with the last Convex snapshot
  2. When PartyKit is unreachable, diagram viewer shows read-only mode with the last Convex snapshot
  3. When PartyKit is unreachable, task description shows read-only mode with the last Convex snapshot
  4. User sees a clear indicator when collaboration features are degraded (connection status UI)
**Plans**: 4 plans

Plans:
- [x] 17-01-PLAN.md — Offline infrastructure (timeout fallback, IndexedDB-first loading, snapshot query, ConnectionStatus redesign)
- [x] 17-02-PLAN.md — Wire offline mode into document, diagram, and task editors with snapshot fallback and recovery
- [ ] 17-03-PLAN.md — Gap closure: cache roomId in PartyKit storage for onAlarm snapshot saves
- [ ] 17-04-PLAN.md — Gap closure: IndexedDB guard for empty documentId and reconnection backoff

## Progress

**Execution Order:**
Phases execute in numeric order: 14 → 15 → 16 → 17

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Projects Foundation | v0.8 | 3/3 | Complete | 2026-02-07 |
| 2. Basic Tasks | v0.8 | 4/4 | Complete | 2026-02-07 |
| 3. Kanban Board View | v0.8 | 3/3 | Complete | 2026-02-07 |
| 3.1. Default taskStatus logic (INSERTED) | v0.8 | 1/1 | Complete | 2026-02-10 |
| 3.2. taskStatus per project scope (INSERTED) | v0.8 | 2/2 | Complete | 2026-02-10 |
| 4. Chat-to-Task Integration | v0.8 | 2/2 | Complete | 2026-02-07 |
| 5. Document-Diagram Embeds | v0.8 | 3/3 | Complete | 2026-02-07 |
| 6. Task Comments | v0.8 | 1/1 | Complete | 2026-02-07 |
| 6.1. Mention People (INSERTED) | v0.8 | 1/1 | Complete | 2026-02-07 |
| 7. Notifications and Polish | v0.8 | 2/2 | Complete | 2026-02-07 |
| 8. Emoji Reactions Foundation | v0.9 | 2/2 | Complete | 2026-02-07 |
| 9. @User Mentions in Chat | v0.9 | 2/2 | Complete | 2026-02-07 |
| 10. Inline Reply-To | v0.9 | 2/2 | Complete | 2026-02-07 |
| 11. PartyKit Infrastructure & Persistence | v0.10 | 2/2 | Complete | 2026-02-11 |
| 12. Document Multiplayer Cursors & Yjs Migration | v0.10 | 2/2 | Complete | 2026-02-11 |
| 13. Diagram Multiplayer Cursors | v0.10 | 2/2 | Complete | 2026-02-11 |
| 13.1. Fix deployment pipeline (INSERTED) | v0.10 | 1/1 | Complete | 2026-02-11 |
| 13.2. Task collaborative editing (INSERTED) | v0.10 | 2/2 | Complete | 2026-02-12 |
| 14. Protocol Foundation | v0.11 | 1/1 | Complete | 2026-02-12 |
| 15. Persistence Layer | v0.11 | 2/2 | Complete | 2026-02-12 |
| 16. Auth Resilience | v0.11 | 5/5 | Complete | 2026-02-12 |
| 17. Graceful Degradation | v0.11 | 2/4 | In Progress | — |
