# Plan: Calendar Scheduling & Temporal Task Model

> Source PRD: `plans/calendar-scheduling.md`

## Architectural decisions

- **Route**: Calendar lives at `/workspaces/:workspaceId/projects/:projectId/calendar` — unchanged
- **Schema**: `tasks` table drops `startDate`; gains `plannedStartDate` (ISO date string) and `workPeriods` (array of `{startedAt: number, completedAt?: number}`); `dueDate` and `estimate` unchanged
- **Derived values**: `plannedEndDate` = `plannedStartDate + estimate` in calendar days — computed client-side, never stored; same for `actualStartDate`, `totalActualTime`
- **Commitment multiplier**: Planned/Commitment toggle is a client-side multiplier (1× or 5×) — no server changes required
- **Migration**: `startDate` dropped with no data migration — calendar branch is WIP with no production data to preserve
- **Cycle deadline inheritance**: Cycle `dueDate` acts as soft deadline for tasks assigned to that cycle with no own `dueDate` — resolved client-side at render time

---

## Phase 1: Schema + Work Period Tracking

**User stories**: 21, 22, 23

### What to build

Replace the single `startDate` field with two new structures: `plannedStartDate` (an ISO date string set by the PM) and `workPeriods` (an append-only array of start/end timestamps managed by status transitions).

When a task transitions into a status with `setsStartDate: true`, a new open work period is appended. If the task already has a closed work period, the new entry is appended alongside the existing history — supporting restart cycles. When a task transitions into a completed status, the currently open work period is closed by setting `completedAt`. No mutation overwrites an existing closed period.

The `plannedStartDate` field is set explicitly via task create/update and is never touched by status transitions.

### Acceptance criteria

- [ ] Tasks no longer have a `startDate` field; existing code references to `startDate` are removed
- [ ] `plannedStartDate` can be set and updated on a task independently of status
- [ ] Transitioning to a `setsStartDate` status on a task with no prior work periods creates one open entry in `workPeriods`
- [ ] Transitioning to a completed status closes the open work period entry
- [ ] Transitioning to a `setsStartDate` status on a task with a closed work period appends a new open entry (restart cycle preserved)
- [ ] Tests cover all three status transition scenarios above
- [ ] Tests cover that `plannedStartDate` is stored and retrieved correctly
- [ ] Tests verify no mutation reads or writes `startDate`

---

## Phase 2: Calendar Renders the New Model

**User stories**: 3, 4, 7, 17

### What to build

Update the calendar to position and size tasks using `plannedStartDate` and the derived `plannedEndDate` (`plannedStartDate + estimate` in calendar days). Tasks with no estimate render as a 1-day block with a dashed border to signal the estimate is missing. Tasks with an estimate render with width proportional to their duration.

Conflict detection: a task block turns red when its `plannedEndDate` exceeds its `dueDate`. The status color moves to a dot on the block rather than the block fill, so conflict color and status color coexist without collision. Tasks with an open work period (active execution) render as solid blocks; all others are outlined/muted.

### Acceptance criteria

- [ ] Calendar uses `plannedStartDate` to position tasks; `startDate` is not referenced
- [ ] Block width reflects estimate in calendar days
- [ ] Tasks with no estimate render as a 1-day block with a dashed border
- [ ] Block turns red when `plannedEndDate > dueDate`
- [ ] Status is represented by a colored dot on the block, not the block fill
- [ ] Tasks with an open work period render as solid; tasks without render as outlined/muted
- [ ] Calendar renders correctly when tasks have no `plannedStartDate` (they do not appear)

---

## Phase 3: Unscheduled Drawer + Drag-to-Schedule

**User stories**: 1, 2, 5, 6, 19

### What to build

Add an unscheduled tasks drawer to the calendar view: a right panel on desktop (≥ md breakpoint) and a bottom sheet on mobile. The drawer lists all tasks in the project that have no `plannedStartDate`.

Dragging a task from the drawer onto a calendar date sets its `plannedStartDate` and removes it from the drawer. Dragging an existing task block to a new date updates `plannedStartDate`. Block resize is disabled — width is always derived from estimate and cannot be changed via the calendar.

### Acceptance criteria

- [ ] Drawer is visible as a right panel on desktop and a bottom sheet on mobile
- [ ] Drawer lists all tasks with no `plannedStartDate`
- [ ] Dragging a task from the drawer onto a date sets `plannedStartDate` and removes the task from the drawer
- [ ] Dragging an existing task block to a new date updates `plannedStartDate`
- [ ] Task blocks cannot be resized
- [ ] Drawer updates in real time when tasks gain or lose a `plannedStartDate`

---

## Phase 4: Planned/Commitment Toggle

**User stories**: 8, 9

### What to build

Add a toggle to the calendar toolbar that switches between Planned and Commitment views. In Planned mode (default), block widths and `plannedEndDate` are derived from the raw estimate. In Commitment mode, all estimate-derived values are multiplied by 5. Conflict detection (red block when `plannedEndDate > dueDate`) updates in both modes — a task that looks safe in Planned mode may become a conflict in Commitment mode.

The toggle is purely client-side; no server requests are made when switching.

### Acceptance criteria

- [ ] Calendar toolbar has a Planned/Commitment toggle, defaulting to Planned
- [ ] In Commitment mode, all task block widths are 5× their Planned width
- [ ] Conflict detection (red block) uses the Commitment-adjusted `plannedEndDate` in Commitment mode
- [ ] Switching modes does not trigger any server requests
- [ ] Tasks with no estimate are unaffected by the toggle (still render as 1-day minimum)

---

## Phase 5: Cycle Integration

**User stories**: 10, 11, 12, 13, 18

### What to build

Two enhancements to cycle behavior on the calendar:

**Soft deadline inheritance**: tasks assigned to a cycle with no own `dueDate` inherit the cycle's `dueDate` for conflict detection purposes. This is resolved at render time — no data is written to the task.

**Cycle detail panel**: clicking a cycle background band opens a panel showing the cycle's name, date range, and status. The panel includes a Hofstadter aggregate section: the sum of all task estimates in the cycle, the planning hours (× 1.6), and the commitment hours (× 5). Tasks with no estimate are excluded from the sum; the count of unestimated tasks is shown separately.

### Acceptance criteria

- [ ] Tasks in a cycle with no own `dueDate` show conflict coloring when `plannedEndDate` exceeds the cycle's `dueDate`
- [ ] Tasks with their own `dueDate` use their own value, ignoring the cycle's
- [ ] Clicking a cycle background band opens the cycle detail panel
- [ ] Cycle detail panel shows name, date range, and status
- [ ] Panel shows Σ raw estimates, planned hours (× 1.6), and commitment hours (× 5)
- [ ] Unestimated tasks are excluded from the aggregate with a count displayed
- [ ] Tests cover cycle aggregation query with mixed estimated/unestimated tasks

---

## Phase 6: Task Detail Surfaces

**User stories**: 14, 15, 16

### What to build

Update the task detail sheet with three additions:

- A `plannedStartDate` date picker field so PMs can schedule tasks without using the calendar drag interaction
- Hofstadter multiplier labels adjacent to the estimate input: "Plan: Xh" (× 1.6) and "Commit: Xh" (× 5), shown only when an estimate is set
- A work history section showing each entry in `workPeriods` as a start/end pair with computed duration; open periods show start time only

### Acceptance criteria

- [ ] `plannedStartDate` date picker is present in the task detail sheet
- [ ] Setting `plannedStartDate` via the date picker updates the task and reflects on the calendar
- [ ] When estimate is set, "Plan: Xh" and "Commit: Xh" labels are shown adjacent to the estimate field
- [ ] When estimate is not set, no multiplier labels are shown
- [ ] Work history section lists each work period with start, end, and duration
- [ ] Open (in-progress) work periods show start time and an in-progress indicator

---

## Phase 7: Click-to-Create

**User stories**: 20

### What to build

Clicking an empty slot on the calendar opens a quick-create form with `plannedStartDate` pre-filled to the clicked date. On submit, the task is created and immediately appears on the calendar at that date.

### Acceptance criteria

- [ ] Clicking an empty calendar slot opens a task creation form
- [ ] The form pre-fills `plannedStartDate` with the clicked date
- [ ] Submitting the form creates the task and places it on the calendar
- [ ] Dismissing the form without submitting creates no task
