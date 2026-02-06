# Ripple

## What This Is

A real-time collaborative workspace that aims to be a focused, better-integrated alternative to MS Teams. Features chat, video calls, documents, diagrams, and task management that seamlessly interconnect — where everything can reference and embed everything else.

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

### Active

<!-- Current scope. Building toward these. -->

- [ ] @user mentions in chat with autocomplete and push notifications
- [ ] Emoji reactions on messages (Slack-style pills with counts)
- [ ] Inline reply-to messages with quoted preview
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

## Current Milestone: v0.9 Chat Features

**Goal:** Enrich chat with @user mentions, emoji reactions, and inline reply-to — bringing chat interaction quality closer to Slack/Teams.

**Target features:**
- @user mentions in chat with autocomplete, styled chips, and push notifications
- Emoji reactions on messages (Slack-style pills with counts, emoji picker)
- Inline reply-to with quoted preview of original message in chat flow

## Context

Shipped v0.8 with ~20,568 net lines of TypeScript across 180 files.
Tech stack: Convex, React 18, React Router v6, Tailwind CSS, shadcn/ui, BlockNote, dnd-kit, fractional-indexing.
Task management fully integrated with existing chat, documents, and diagrams.
Chat currently has task/project mention chips but no @user mentions, no reactions, no reply-to.

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

---
*Last updated: 2026-02-07 after v0.9 milestone start*
