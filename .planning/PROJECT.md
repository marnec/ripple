# Ripple

## What This Is

A real-time collaborative workspace that aims to be a focused, better-integrated alternative to MS Teams. Features chat, video calls, documents, and diagrams that seamlessly interconnect — where everything can reference and embed everything else.

## Core Value

Seamless integration between all workspace features — users, documents, diagrams, and tasks can reference and embed each other, creating a connected workspace rather than isolated tools.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Authentication (GitHub OAuth, email OTP, password) — existing
- ✓ Workspaces with membership and role-based access control — existing
- ✓ Channels (public/private) with real-time messaging — existing
- ✓ Full-text search on messages — existing
- ✓ User tagging in chat — existing
- ✓ Collaborative documents with BlockNote editor — existing
- ✓ Real-time presence and cursor awareness — existing
- ✓ Excalidraw diagrams embeddable in documents — existing
- ✓ Push notifications — existing
- ✓ Video calls infrastructure (WebRTC signaling) — existing (drafted)
- ✓ Workspace invites via email — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Projects as workspace-level entity containing tasks
- [ ] Project membership with visibility controls
- [ ] Auto-create channel when project is created (inherits project membership)
- [ ] Projects can link to multiple channels (many-to-many)
- [ ] Kanban board view for task management
- [ ] Task properties: title, description, status, assignee(s), due date, priority, labels
- [ ] Create task from chat message (one-click capture)
- [ ] Embed users, documents, diagrams in task descriptions (inline preview)
- [ ] Reference projects from any channel user has visibility on
- [ ] Push notifications for task assignment and mentions

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Configurable task views (list, calendar) — v2, start with Kanban only
- Guest members — v2, focus on team collaboration first
- Development cycles/sprints — v2, keep v1 simple
- Dashboards — v2, need task data first
- Mobile app — web-first approach

## Context

**Existing Architecture:**
- Convex serverless backend with real-time subscriptions
- React 18 frontend with React Router v6
- Three-tier RBAC: workspace → channel/document → member roles
- Established patterns for membership tables with composite indexes
- BlockNote editor with custom blocks (DiagramBlock, UserBlock already exist)
- Push notification infrastructure ready

**Integration Model:**
The core differentiator is deep cross-feature integration. Current integrations:
- User mentions in chat
- Diagram embeds in documents with inline preview

New integrations to build:
- Tasks can embed users, documents, diagrams
- Chat messages can become tasks
- Projects link to channels

## Constraints

- **Tech stack**: Convex backend, React frontend — maintain consistency with existing patterns
- **RBAC pattern**: Follow established membership table pattern (projectMembers like channelMembers/documentMembers)
- **Real-time**: All task operations must be real-time via Convex subscriptions
- **Mobile-ready**: UI must work on tablet/mobile even without dedicated app

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Projects as separate entity from channels | Tasks need their own container that can link to multiple channels | — Pending |
| Kanban-only for v1 | Reduce scope, validate core task model before adding views | — Pending |
| Project creates auto-channel | Every project needs a discussion space by default | — Pending |
| Project membership controls channel | Simpler mental model — project is primary, channel inherits | — Pending |

---
*Last updated: 2026-02-05 after initialization*
