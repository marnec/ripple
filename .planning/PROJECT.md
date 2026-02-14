# Ripple

## What This Is

A real-time collaborative workspace that aims to be a focused, better-integrated alternative to MS Teams. Features chat, video calls, documents, diagrams, and task management that seamlessly interconnect — where everything can reference and embed everything else. Production-ready collaboration with data durability, automatic reconnection, and graceful offline degradation.

## Core Value

Seamless integration between all workspace features — users, documents, diagrams, and tasks can reference and embed each other, creating a connected workspace rather than isolated tools.

## Requirements

### Validated

- ✓ Authentication (GitHub OAuth, email OTP, password) — existing
- ✓ Workspaces with membership and role-based access control — existing
- ✓ Channels (public/private) with real-time messaging — existing
- ✓ Full-text search on messages — existing
- ✓ Task/project mention chips in chat composer — existing
- ✓ Collaborative documents with BlockNote editor — existing
- ✓ Real-time presence and cursor awareness — existing
- ✓ Excalidraw diagrams embeddable in documents — existing
- ✓ Push notifications — existing
- ✓ Video calls infrastructure (WebRTC signaling) — existing (drafted)
- ✓ Workspace invites via email — existing
- ✓ Projects as workspace-level containers with membership-based access — v0.8
- ✓ Auto-create channel when project is created — v0.8
- ✓ Task CRUD with status, assignee, priority, labels — v0.8
- ✓ Cross-project "My Tasks" view — v0.8
- ✓ Kanban board with drag-drop and real-time updates — v0.8
- ✓ Create task from chat message with context capture — v0.8
- ✓ Task/project mention chips in chat — v0.8
- ✓ Embed diagrams, documents, users, projects in task descriptions — v0.8
- ✓ Task comments with @mentions — v0.8
- ✓ Push notifications for task assignments and @mentions — v0.8
- ✓ @user mentions in chat with autocomplete and push notifications — v0.9
- ✓ Emoji reactions on messages (Slack-style pills with counts) — v0.9
- ✓ Inline reply-to messages with quoted preview — v0.9
- ✓ PartyKit WebSocket infrastructure with Yjs snapshot persistence — v0.10
- ✓ Real-time multiplayer cursors in BlockNote documents — v0.10
- ✓ Full Yjs migration replacing ProseMirror Sync for documents — v0.10
- ✓ Real-time multiplayer cursors in Excalidraw diagrams — v0.10
- ✓ Collaborative Yjs-based task description editing — v0.10
- ✓ Active users avatar stacks and connection status indicators — v0.10
- ✓ CI/CD pipeline for multi-service deployment — v0.10
- ✓ Yjs→Convex snapshot persistence on session close (content recovery) — v0.11
- ✓ Token refresh mechanism for WebSocket reconnection without page reload — v0.11
- ✓ Permission re-validation in PartyKit (periodic membership re-check) — v0.11
- ✓ Content recovery path from Convex backup — v0.11
- ✓ Graceful degradation on PartyKit unavailability — v0.11
- ✓ Shared TypeScript protocol types for collaboration layer — v0.11

### Active

<!-- Current scope. Building toward these. -->

- [ ] Due dates on tasks
- [ ] Board filters (by assignee, priority, labels)
- [ ] Configurable views (list view, calendar view)
- [ ] Project-channel many-to-many links

### Out of Scope

- Guest members — v2, focus on team collaboration first
- Development cycles/sprints — keep it lightweight, not Scrum ceremonies
- Dashboards and analytics — need more task data first
- Mobile app — web-first approach
- Sprint/cycle planning — keep it lightweight
- Burndown charts — analytics before workflows are proven
- Multi-assignee tasks — diffuses accountability; use @mentions for collaborators
- Custom workflows beyond columns — users spend days configuring; fixed model is better
- Recurring tasks — edge cases for scheduling logic; wait for user requests
- Gantt charts — implies false precision; Kanban is more flexible
- External task sharing — security complexity; workspace members only
- Periodic flush during editing — snapshot-only on disconnect; periodic flush adds write load
- Active push revocation (Convex→PartyKit) — pull-based re-validation is simpler and sufficient
- Version history / audit trail — snapshot backup is for recovery, not versioning
- Sync health monitoring dashboard — defer to ops milestone

## Context

Shipped v0.11 with production-ready collaboration layer.
Tech stack: Convex, React 18, React Router v6, Tailwind CSS, shadcn/ui, BlockNote, Excalidraw, PartyKit, Yjs, y-partykit, y-indexeddb, Zod.
Collaborative editing uses Yjs CRDTs via PartyKit WebSocket. Presence uses Yjs Awareness.
Yjs state persists to Convex as binary snapshots (periodic 30s saves + disconnect debounce). Cold-start loads from Convex when PartyKit storage empty.
Token refresh via async params function enables seamless WebSocket reconnection.
Permission re-validation every 30s disconnects revoked users gracefully.
Graceful degradation: 4s timeout → IndexedDB cache fallback → Convex snapshot read-only mode.
CI/CD deploys Convex, PartyKit, and Cloudflare Workers sequentially via GitHub Actions.

## Constraints

- **Tech stack**: Convex backend, React frontend — maintain consistency with existing patterns
- **RBAC pattern**: Follow established membership table pattern (projectMembers like channelMembers/documentMembers)
- **Real-time**: All task operations must be real-time via Convex subscriptions
- **Mobile-ready**: UI must work on tablet/mobile even without dedicated app

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Projects as separate entity from channels | Tasks need their own container that can link to multiple channels | ✓ Good |
| Kanban-only for v1 | Reduce scope, validate core task model before adding views | ✓ Good |
| Project creates auto-channel | Every project needs a discussion space by default | ✓ Good |
| Project membership controls channel | Simpler mental model — project is primary, channel inherits | ✓ Good |
| Inline status seeding in mutations | Convex mutations can't call other mutations | ✓ Good |
| Freeform string labels for v1 | Fast to ship, migrate to label entities later | ⚠️ Revisit |
| Denormalized completed field on tasks | Efficient hideCompleted filtering without joins | ✓ Good |
| Fractional indexing for card ordering | No renumbering needed, dnd-kit compatible | ✓ Good |
| Four custom BlockNote inline content types | Deep cross-feature integration in task descriptions | ✓ Good |
| Separate taskCommentSchema | Comments lighter than descriptions, only need @mentions | ✓ Good |
| Diff-based mention detection | Prevents duplicate notifications on edits | ✓ Good |
| mentionedUserIds as v.array(v.string()) | IDs come from JSON parsing, not typed Convex IDs | ⚠️ Revisit |
| Chat mentions: create-only notifications | v1 simplification - only notify on new messages, not edits | ✓ Good |
| Separate chat notification action | Chat needs different context (#channel) than tasks | ✓ Good |
| Pass plainText to notification action | Simpler than querying message by ID for preview | ✓ Good |
| Discriminated union for WebSocket messages | TypeScript narrowing in switch statements; compile-time protocol safety | ✓ Good |
| Error severity classification (terminal vs recoverable) | Guides retry vs user notification logic in graceful degradation | ✓ Good |
| yjsSnapshotId field naming | Clarifies Yjs-specific binary data vs potential future snapshot types | ✓ Good |
| Periodic save interval 30s + disconnect debounce 7s | Balances data durability with Convex write load | ✓ Good |
| Dynamic token refresh via async params function | y-partykit calls params on each reconnect; fresh token without page reload | ✓ Good |
| Fail-open pattern for permission checks | Availability over strict security; only disconnect on explicit access revocation | ✓ Good |
| Server-to-server auth via PARTYKIT_SECRET | Shared secret for Convex HTTP endpoints; prevents client spoofing | ✓ Good |
| 4-second connection timeout for graceful degradation | Within 3-5s user decision threshold; non-blocking (provider keeps trying) | ✓ Good |
| Dual-source loading (provider OR IndexedDB) | Fastest-source-wins for optimal perceived performance | ✓ Good |
| SVG preview storage for diagram embeds | Excalidraw exportToSvg every 10s; renders inline in documents and tasks | ✓ Good |
| Exponential backoff on reconnection (max 3 attempts) | Prevents auth storms; 2s, 4s, 8s then offline mode | ✓ Good |

---
*Last updated: 2026-02-14 after v0.11 milestone*
