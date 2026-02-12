# Project Milestones: Ripple Task Management

## v0.8 Task Management (Shipped: 2026-02-07)

**Delivered:** Full task management system integrated across all workspace features — projects, Kanban boards, chat-to-task capture, document/diagram embeds, comments with @mentions, and push notifications.

**Phases completed:** 1-7 + 6.1 (20 plans total)

**Key accomplishments:**

- Project containers with membership-based access control and auto-linked discussion channels
- Full task CRUD with customizable statuses, priorities, labels, and cross-project "My Tasks" view
- Drag-and-drop Kanban board with fractional indexing and optimistic real-time updates
- Task creation from chat messages with live-updating task/project mention chips
- Four custom inline content types (diagrams, documents, users, projects) with # and @ autocomplete
- Rich text comments with @mentions and push notifications for assignments and mentions

**Stats:**

- 180 files created/modified
- ~20,568 net lines of TypeScript/CSS
- 8 phases, 20 plans, 28 requirements
- 2 days from start to ship (70.1 min execution time)

**Git range:** `feat(01-01)` → `feat(07-02)`

**What's next:** v0.9 — chat feature enrichment

---

## v0.9 Chat Features (Shipped: 2026-02-07)

**Delivered:** Rich chat interactions with emoji reactions, @user mentions with autocomplete and notifications, and inline reply-to with quoted previews.

**Phases completed:** 8-10 (6 plans total)

**Key accomplishments:**

- Emoji reactions on messages (Slack-style pills with counts and hover tooltips)
- @user mentions in chat with autocomplete dropdown and push notifications
- Inline reply-to messages with quoted preview and graceful handling of deleted originals

**Stats:**

- 6 plans, 15 requirements
- Shipped same day as v0.8

**Git range:** `feat(08-01)` → `feat(10-02)`

**What's next:** v0.10 — multiplayer cursors and collaboration infrastructure

---

## v0.10 Multiplayer Cursors & Collaboration (Shipped: 2026-02-11)

**Delivered:** Real-time multiplayer cursor awareness in documents and diagrams, full Yjs migration replacing ProseMirror Sync, PartyKit WebSocket infrastructure, and collaborative task editing.

**Phases completed:** 11-13 + 13.1, 13.2 (9 plans total)

**Key accomplishments:**

- PartyKit server deployed with Yjs snapshot persistence and one-time token auth
- Complete ProseMirror Sync → Yjs migration for BlockNote documents
- Real-time cursor awareness in BlockNote docs (positions, selections, colored labels)
- Real-time pointer tracking in Excalidraw diagrams with lock indicators
- Active users avatar stacks and connection status indicators
- CI/CD pipeline for multi-service deployment (Convex, PartyKit, Cloudflare Workers)
- Collaborative Yjs-based task description editing

**Stats:**

- 5 phases (11, 12, 13, 13.1, 13.2), 9 plans, 19 requirements
- 4 days from start to ship (59.7 min execution time)

**Git range:** `feat(11-01)` → `fix(13.2)`

**What's next:** v0.11 — architectural risk mitigation for PartyKit/Convex split persistence

---
