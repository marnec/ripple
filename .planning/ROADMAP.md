# Roadmap: Ripple

## Milestones

- ✅ **v0.8 Task Management** - Phases 01-07 (shipped 2026-02-07)
- ✅ **v0.9 Chat Features** - Phases 08-10 (shipped 2026-02-07)

## Overview

v0.9 brings Ripple's chat interactions up to modern standards with emoji reactions, @user mentions, and inline reply-to. These three features transform chat from basic messaging into a rich communication layer comparable to Slack and Teams, completing the core workspace collaboration toolkit.

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
- [ ] 03.2-01-PLAN.md — Schema migration and project-scoped taskStatuses backend with cascade delete
- [ ] 03.2-02-PLAN.md — Frontend updates for project-scoped status APIs and cascade delete UX

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

### ✅ v0.9 Chat Features (SHIPPED 2026-02-07)

**Milestone Goal:** Enrich chat with @user mentions, emoji reactions, and inline reply-to — bringing chat interaction quality closer to Slack/Teams.

#### Phase 08: Emoji Reactions Foundation
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

#### Phase 09: @User Mentions in Chat
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

#### Phase 10: Inline Reply-To
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

## Progress

**Execution Order:**
Phases execute in numeric order: 08 → 09 → 10

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Projects Foundation | v0.8 | 3/3 | Complete | 2026-02-07 |
| 2. Basic Tasks | v0.8 | 4/4 | Complete | 2026-02-07 |
| 3. Kanban Board View | v0.8 | 3/3 | Complete | 2026-02-07 |
| 3.1. Default taskStatus logic (INSERTED) | v0.8 | 1/1 | Complete | 2026-02-10 |
| 3.2. taskStatus per project scope (INSERTED) | v0.8 | 0/2 | Planned | — |
| 4. Chat-to-Task Integration | v0.8 | 2/2 | Complete | 2026-02-07 |
| 5. Document-Diagram Embeds | v0.8 | 3/3 | Complete | 2026-02-07 |
| 6. Task Comments | v0.8 | 1/1 | Complete | 2026-02-07 |
| 6.1. Mention People (INSERTED) | v0.8 | 1/1 | Complete | 2026-02-07 |
| 7. Notifications and Polish | v0.8 | 2/2 | Complete | 2026-02-07 |
| 8. Emoji Reactions Foundation | v0.9 | 2/2 | Complete | 2026-02-07 |
| 9. @User Mentions in Chat | v0.9 | 2/2 | Complete | 2026-02-07 |
| 10. Inline Reply-To | v0.9 | 2/2 | Complete | 2026-02-07 |
