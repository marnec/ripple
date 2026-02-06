# Phase 2: Basic Tasks - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Core task CRUD within projects: create, read, update, delete tasks with properties (title, description, status, assignee, priority, labels). Includes a task list view per project and a cross-project "My Tasks" view. Kanban visualization is Phase 3. Comments are Phase 6.

</domain>

<decisions>
## Implementation Decisions

### Task creation & editing flow
- Quick inline add in the task list (title only, hit Enter) for fast capture
- Clicking a task opens a side panel (slides in from right) with full detail and editing
- Side panel has an expand option to go to a dedicated full page
- Full BlockNote editor for task descriptions (same rich editor as Documents)
- All properties available during creation (status, priority, assignee, labels) — user fills what they want

### Claude's Discretion: Creation modal
- User reconsidered the creation modal since the side panel handles full editing
- Claude decides whether inline add alone is sufficient, or if a lightweight modal adds value for the "create with properties upfront" flow
- Key consideration: inline add only captures title — if users often want to set properties at creation time, a modal or immediate side-panel-open may be needed

### Task list view
- Compact list layout (stacked rows with title + key metadata inline, like GitHub Issues)
- No default grouping — flat list sorted by creation date
- Each row shows: title, status (colored badge), priority (icon), assignee (avatar)
- Labels visible in detail panel only, not in list rows
- Completed tasks hidden by default with a filter toggle at the top to show/hide them

### My Tasks (cross-project)
- Accessible from sidebar as a dedicated page, plus each project can filter to user's tasks
- Grouped by project with collapsible sections
- No filtering or sorting for v1 — just the grouped list
- Clicking a task opens the detail side panel in-place (stays on My Tasks page, doesn't navigate to project)

### Claude's Discretion
- Task row hover/selection styling
- Status badge colors and priority icon design
- Default sort order within project task lists
- Empty state design for tasks (per-project and My Tasks)
- Task deletion confirmation pattern
- How labels work (predefined set, freeform tags, or colored labels)
- Status column customization UI (success criteria #5 requires customizable columns)

</decisions>

<specifics>
## Specific Ideas

- Compact list inspired by GitHub Issues — dense, scannable rows
- Side panel inspired by Linear — slides in from right, list stays visible behind it
- Quick inline add should feel instant — type title, Enter, done

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-basic-tasks*
*Context gathered: 2026-02-06*
