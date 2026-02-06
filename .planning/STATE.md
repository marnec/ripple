# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-05)

**Core value:** Seamless integration between all workspace features — users, documents, diagrams, and tasks can reference and embed each other, creating a connected workspace rather than isolated tools.
**Current focus:** Phase 3 - Kanban Board View (In Progress)

## Current Position

Phase: 3 of 7 (Kanban Board View)
Plan: 3 of 4 in current phase
Status: In progress - awaiting checkpoint verification
Last activity: 2026-02-06 — Executing 03-03-PLAN.md (at checkpoint)

Progress: [████████░░] ~50%

## Performance Metrics

**Velocity:**
- Total plans completed: 10
- Average duration: 3.8 min
- Total execution time: 38 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-projects-foundation | 4 | 14 min | 3.5 min |
| 02-basic-tasks | 4 | 19 min | 4.8 min |
| 03-kanban-board-view | 2 | 5 min | 2.5 min |

**Recent Trend:**
- Last 5 plans: 02-03 (6 min), 02-04 (5 min), 03-01 (2 min), 03-02 (3 min)
- Trend: Improving

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Projects as separate entity from channels (tasks need container that can link to multiple channels)
- Kanban-only for v1 (reduce scope, validate core task model before adding views)
- Project creates auto-channel (every project needs discussion space by default)
- Project membership controls channel (simpler mental model - project is primary, channel inherits)
- No ProjectRole enum - binary access model (member or not), creatorId determines admin
- Linked channel naming: `${projectName} Discussion` format
- Alphabetical sort for project listing in sidebar
- Sidebar ordering: Channels > Projects > Documents > Diagrams
- Color dot uses project.color Tailwind class directly
- 8 project colors: Blue, Green, Yellow, Red, Purple, Pink, Orange, Teal (Tailwind 500 shades)
- Color picker uses ring-2 visual indicator for selected state
- Default project color: bg-blue-500
- Creator-only access control: isCreator = currentUser._id === project.creatorId
- Members cannot remove themselves from projects
- Use api.users.viewer for current user query (codebase convention)
- Inline status seeding in tasks.create mutation (can't call mutations from mutations)
- Freeform string labels for v1 (migrate to label entities in Phase 3+)
- Denormalized completed field on tasks for efficient hideCompleted filtering
- Enriched queries return nested objects with status/assignee/project data
- Status badge colored dot pattern (colored dot before text, not background - avoids contrast issues)
- Hide-completed defaults to true (users see active tasks first)
- Rapid entry pattern: inline creation clears and refocuses input after submit
- Priority icon visual system: dual-coding with color + shape for accessibility
- Track closed groups instead of open groups for default-expanded collapsible sections (avoids setState in useEffect)
- My Tasks positioned above all section lists in sidebar (personal productivity shortcut)
- Task detail sheet slides from right (not modal - maintains context with list)
- Auto-save pattern for task properties: individual updates, no save button (Convex reactivity makes this safe)
- BlockNote for task descriptions with 500ms debounce (reduces write frequency)
- Separate TaskDetailPage component for full-page view (reusable logic, different layout)
- Assignee dropdown includes explicit "Unassigned" option (sets assigneeId to undefined)
- position field is v.optional() for backward compatibility with existing tasks
- generateKeyBetween auto-calculates position at end of status column when not provided
- listByProject sorts by position with _creationTime fallback for legacy tasks
- updatePosition mutation dedicated to drag-drop for performance (only updates statusId, position, completed)
- Fractional indexing via generateKeyBetween for flexible ordering without renumbering
- Dedicated lightweight mutations for high-frequency operations (updatePosition for drag-drop)
- Board view defaults to active (Kanban is phase focus)
- closestCorners collision detection for better multi-container Kanban drag handling
- Split presentational and draggable components (CardPresenter + Card) for DragOverlay reuse
- 8px PointerSensor activation distance to distinguish clicks from drags
- Optimistic updates via useMutation().withOptimisticUpdate() for instant drag feedback

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-02-06T10:13:09Z
Stopped at: Checkpoint in 03-03-PLAN.md (Task 2 - human verification)
Resume file: None

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
