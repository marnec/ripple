# Roadmap: Ripple Task Management

## Overview

Ripple's task management integration follows a dependency-driven structure: establish project containers with proper RBAC patterns, build stable task CRUD operations, add Kanban visualization with real-time drag-drop, integrate with existing chat/documents/diagrams for cross-feature references, and finish with notifications and commenting. Each phase delivers a coherent, verifiable capability building toward a unified workspace where tasks connect seamlessly with conversations and documents.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Projects Foundation** - Project containers with membership-based access control
- [ ] **Phase 2: Basic Tasks** - Core task CRUD with properties and list view
- [ ] **Phase 3: Kanban Board View** - Drag-drop board with real-time updates
- [ ] **Phase 4: Chat-to-Task Integration** - Create tasks from messages with context capture
- [ ] **Phase 5: Document & Diagram Embeds** - Cross-feature references in task descriptions
- [ ] **Phase 6: Task Comments** - Threaded discussions on tasks
- [ ] **Phase 7: Notifications & Polish** - Push notifications and final integrations

## Phase Details

### Phase 1: Projects Foundation
**Goal**: Users can create and manage projects as containers for tasks with role-based access control
**Depends on**: Nothing (first phase)
**Requirements**: PROJ-01, PROJ-02, PROJ-03, PROJ-04, PROJ-05
**Success Criteria** (what must be TRUE):
  1. User can create a project within a workspace they are a member of
  2. User can view a list of all projects they have access to in the workspace
  3. Project automatically creates a dedicated channel that inherits project membership
  4. User with admin role can rename and delete projects
  5. Project membership controls who can view the project and its tasks
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md — Backend schema and API (projects + projectMembers tables, CRUD operations)
- [x] 01-02-PLAN.md — Routes and sidebar integration (navigation, ProjectSelectorList)
- [x] 01-03-PLAN.md — Create dialog and project details page
- [x] 01-04-PLAN.md — Settings page with membership management and verification

### Phase 2: Basic Tasks
**Goal**: Users can create and manage tasks within projects with essential properties
**Depends on**: Phase 1 (tasks require project container)
**Requirements**: TASK-01, TASK-02, TASK-03, TASK-04, TASK-05, TASK-06, TASK-07, TASK-08
**Success Criteria** (what must be TRUE):
  1. User can create a task within a project with title and rich text description
  2. User can edit task properties: title, description, status, assignee, priority, labels
  3. User can delete tasks they have permission to modify
  4. User can view all tasks assigned to them across all projects
  5. Task status uses customizable columns with default set (To Do, In Progress, Done)
**Plans**: TBD

Plans:
- TBD (determined during planning)

### Phase 3: Kanban Board View
**Goal**: Users can visualize and organize tasks on a real-time collaborative Kanban board
**Depends on**: Phase 2 (Kanban visualizes task status field)
**Requirements**: KANBAN-01, KANBAN-02, KANBAN-03, KANBAN-04, KANBAN-05
**Success Criteria** (what must be TRUE):
  1. User can view project tasks organized in columns by status on a Kanban board
  2. User can drag and drop tasks between columns to change status
  3. User can drag and drop tasks within a column to reorder them
  4. User can add, rename, and reorder status columns beyond the default three
  5. Multiple users see board updates in real-time when others make changes
**Plans**: TBD

Plans:
- TBD (determined during planning)

### Phase 4: Chat-to-Task Integration
**Goal**: Users can capture action items from conversations by creating tasks from messages
**Depends on**: Phase 2 (task creation infrastructure must be stable)
**Requirements**: CHAT-01, CHAT-02, CHAT-03
**Success Criteria** (what must be TRUE):
  1. User can create a task from a chat message via context menu
  2. Task created from message automatically captures message content and conversation context
  3. When a task is mentioned in chat, an inline preview shows its current status and assignee
**Plans**: TBD

Plans:
- TBD (determined during planning)

### Phase 5: Document & Diagram Embeds
**Goal**: Users can link tasks to documents and diagrams with inline previews
**Depends on**: Phase 2 (tasks need stable rich text descriptions)
**Requirements**: INTEG-01, INTEG-02, INTEG-03, INTEG-04
**Success Criteria** (what must be TRUE):
  1. User can embed Excalidraw diagrams in task descriptions with inline preview
  2. User can link Ripple documents in task descriptions with clickable references
  3. User can @mention other users in task descriptions
  4. User can reference projects from any channel they have visibility on
**Plans**: TBD

Plans:
- TBD (determined during planning)

### Phase 6: Task Comments
**Goal**: Users can discuss tasks through threaded comments
**Depends on**: Phase 2 (core task infrastructure must exist)
**Requirements**: COMM-01, COMM-02, COMM-03
**Success Criteria** (what must be TRUE):
  1. User can add comments to a task
  2. Comments display in chronological order below task details
  3. User can edit and delete their own comments
**Plans**: TBD

Plans:
- TBD (determined during planning)

### Phase 7: Notifications & Polish
**Goal**: Users receive timely notifications for task-related events
**Depends on**: Phases 2, 5, 6 (tasks, mentions, and comments must exist)
**Requirements**: NOTIF-01, NOTIF-02
**Success Criteria** (what must be TRUE):
  1. User receives push notification when assigned to a task
  2. User receives push notification when @mentioned in task descriptions or comments
**Plans**: TBD

Plans:
- TBD (determined during planning)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Projects Foundation | 4/4 | Complete | 2026-02-05 |
| 2. Basic Tasks | 0/TBD | Not started | - |
| 3. Kanban Board View | 0/TBD | Not started | - |
| 4. Chat-to-Task Integration | 0/TBD | Not started | - |
| 5. Document & Diagram Embeds | 0/TBD | Not started | - |
| 6. Task Comments | 0/TBD | Not started | - |
| 7. Notifications & Polish | 0/TBD | Not started | - |
