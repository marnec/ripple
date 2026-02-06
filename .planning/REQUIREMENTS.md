# Requirements

## v1 Requirements

### Projects (PROJ)

- [x] **PROJ-01**: User can create a project within a workspace
- [x] **PROJ-02**: User can rename and delete projects they administer
- [x] **PROJ-03**: Project has membership with admin/member roles (controls visibility)
- [x] **PROJ-04**: Creating a project auto-creates a dedicated channel that inherits project membership
- [x] **PROJ-05**: User can view list of projects they have access to in workspace

### Tasks (TASK)

- [x] **TASK-01**: User can create a task within a project with title and description
- [x] **TASK-02**: User can edit task title and description (rich text via BlockNote)
- [x] **TASK-03**: User can delete tasks they have permission to modify
- [x] **TASK-04**: Task has status (customizable columns, default: To Do → In Progress → Done)
- [x] **TASK-05**: User can assign a single assignee to a task
- [x] **TASK-06**: User can set priority on a task (urgent/high/medium/low)
- [x] **TASK-07**: User can add/remove labels (tags) on a task
- [x] **TASK-08**: User can view all tasks assigned to them across projects

### Kanban Board (KANBAN)

- [x] **KANBAN-01**: User can view project tasks in a Kanban board organized by status columns
- [x] **KANBAN-02**: User can drag-and-drop tasks between columns to change status
- [x] **KANBAN-03**: Kanban board updates in real-time when other users make changes
- [x] **KANBAN-04**: User can add, rename, and reorder columns (customize beyond default 3)
- [x] **KANBAN-05**: User can reorder tasks within a column via drag-and-drop

### Chat Integration (CHAT)

- [x] **CHAT-01**: User can create a task from a chat message via context menu
- [x] **CHAT-02**: Task created from message captures message content as context
- [x] **CHAT-03**: When a task is linked in chat, it shows inline preview (status, assignee)

### Cross-Feature Integration (INTEG)

- [x] **INTEG-01**: User can embed Excalidraw diagrams in task description with inline preview
- [x] **INTEG-02**: User can link Ripple documents in task description (internal link)
- [x] **INTEG-03**: User can @mention users in task descriptions and comments
- [x] **INTEG-04**: User can reference projects from any channel they have visibility on

### Notifications (NOTIF)

- [ ] **NOTIF-01**: User receives push notification when assigned to a task
- [ ] **NOTIF-02**: User receives push notification when @mentioned in a task

### Comments (COMM)

- [ ] **COMM-01**: User can add comments to a task
- [ ] **COMM-02**: Task comments display in chronological thread
- [ ] **COMM-03**: User can edit and delete their own comments

---

## v2 Requirements (Deferred)

### Deferred from v1

- [ ] Due dates on tasks — keep v1 simple, add time-based features later
- [ ] Board filters (by assignee, priority, labels) — basic board first
- [ ] Project-channel many-to-many links — start with auto-created channel only
- [ ] Full document embedding with inline preview — links sufficient for v1

### Future Features

- [ ] Configurable views (list view, calendar view)
- [ ] Guest members for projects
- [ ] Development cycles/sprints
- [ ] Dashboards and analytics
- [ ] Task dependencies (blocking relationships)
- [ ] Sub-tasks
- [ ] Task templates
- [ ] Bulk operations
- [ ] Automation rules

---

## Out of Scope

- **Sprint/cycle planning** — keep it lightweight, not Scrum ceremonies
- **Burndown charts** — analytics before workflows are proven
- **Multi-assignee tasks** — diffuses accountability; use @mentions for collaborators
- **Custom workflows beyond columns** — users spend days configuring; fixed model is better
- **Recurring tasks** — edge cases for scheduling logic; wait for user requests
- **File uploads to tasks** — redundant with document/diagram embeds
- **Gantt charts** — implies false precision; Kanban is more flexible
- **External task sharing** — security complexity; workspace members only
- **Mobile app** — web-first approach

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROJ-01 | Phase 1 | Complete |
| PROJ-02 | Phase 1 | Complete |
| PROJ-03 | Phase 1 | Complete |
| PROJ-04 | Phase 1 | Complete |
| PROJ-05 | Phase 1 | Complete |
| TASK-01 | Phase 2 | Complete |
| TASK-02 | Phase 2 | Complete |
| TASK-03 | Phase 2 | Complete |
| TASK-04 | Phase 2 | Complete |
| TASK-05 | Phase 2 | Complete |
| TASK-06 | Phase 2 | Complete |
| TASK-07 | Phase 2 | Complete |
| TASK-08 | Phase 2 | Complete |
| KANBAN-01 | Phase 3 | Complete |
| KANBAN-02 | Phase 3 | Complete |
| KANBAN-03 | Phase 3 | Complete |
| KANBAN-04 | Phase 3 | Complete |
| KANBAN-05 | Phase 3 | Complete |
| CHAT-01 | Phase 4 | Complete |
| CHAT-02 | Phase 4 | Complete |
| CHAT-03 | Phase 4 | Complete |
| INTEG-01 | Phase 5 | Complete |
| INTEG-02 | Phase 5 | Complete |
| INTEG-03 | Phase 5 | Complete |
| INTEG-04 | Phase 5 | Complete |
| COMM-01 | Phase 6 | Pending |
| COMM-02 | Phase 6 | Pending |
| COMM-03 | Phase 6 | Pending |
| NOTIF-01 | Phase 7 | Pending |
| NOTIF-02 | Phase 7 | Pending |

---

*Last updated: 2026-02-06*
