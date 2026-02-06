---
phase: 02-basic-tasks
plan: "03"
subsystem: tasks
tags: [ui, blocknote, sheet, routing, task-editing]

requires:
  - 02-02 # Task list UI with inline creation

provides:
  - Task detail side panel with full editing
  - BlockNote rich text description editor
  - Full-page task detail view
  - Auto-saving property updates

affects:
  - Future task features (comments, activity log, attachments)

tech-stack:
  added:
    - BlockNote editor for descriptions
  patterns:
    - Sheet component for side panels
    - Debounced auto-save for text input
    - Separate inline and full-page layouts
    - Property-specific mutation calls

decisions:
  - id: task-detail-sheet
    choice: Sheet slides from right (not modal dialog)
    rationale: Maintains context with task list, faster access
  - id: auto-save-pattern
    choice: Individual property updates, no save button
    rationale: Convex reactivity makes this safe and instant
  - id: description-editor
    choice: BlockNote with 500ms debounce
    rationale: Rich text needed for task details, debounce reduces writes
  - id: full-page-layout
    choice: Separate TaskDetailPage component
    rationale: Reusable edit logic, different layout constraints
  - id: assignee-unassigned
    choice: Explicit "Unassigned" option in select
    rationale: Clear UI, sets assigneeId to undefined

key-files:
  created:
    - src/pages/App/Project/TaskDetailSheet.tsx
    - src/pages/App/Project/TaskDetailPage.tsx
  modified:
    - src/pages/App/Project/Tasks.tsx
    - src/pages/App/Project/ProjectDetails.tsx
    - src/routes.tsx

metrics:
  duration: 6 min
  completed: 2026-02-06
---

# Phase 02 Plan 03: Task Detail Side Panel Summary

**One-liner:** Sheet-based task editor with BlockNote descriptions, property dropdowns, and full-page expand option

## What Was Built

### TaskDetailSheet Component
- **Location:** `src/pages/App/Project/TaskDetailSheet.tsx`
- **Props:** taskId, open, onOpenChange, workspaceId, projectId
- **Layout:** Sheet sliding from right (600px/540px responsive)
- **Sections:**
  - **Header:** Editable title input (borderless, saves on blur/Enter), Expand and Delete buttons
  - **Properties:** 2-column grid layout
    - Status: Dropdown with colored dots (from workspace statuses)
    - Priority: Dropdown with icons (urgent/high/medium/low)
    - Assignee: Dropdown with avatars (project members + unassigned)
    - Labels: Freeform tag input (add/remove badges)
  - **Description:** BlockNote rich text editor (min-h-200px, debounced 500ms auto-save)
  - **Delete Dialog:** Confirmation modal before deletion

**Auto-save behavior:**
- Title: saves on blur or Enter key
- Properties: save immediately on change
- Description: debounced 500ms (avoids excessive writes during typing)
- Labels: save immediately when adding/removing

### TaskDetailPage Component
- **Location:** `src/pages/App/Project/TaskDetailPage.tsx`
- **Route:** `/workspaces/:workspaceId/projects/:projectId/tasks/:taskId`
- **Layout:** Full-page container (max-w-4xl)
- **Differences from Sheet:**
  - Back button (returns to project)
  - Larger title (text-2xl vs text-lg)
  - Wider property selectors (w-64)
  - More vertical space for description (min-h-300px)
  - Same editing logic and auto-save pattern

### Task List Integration
- **Tasks.tsx:**
  - Added `selectedTaskId` state (typed as `Id<"tasks"> | null`)
  - Wire TaskRow onClick to set selectedTaskId
  - Render TaskDetailSheet with props
  - Sheet closes when onOpenChange(false)
- **ProjectDetails.tsx:**
  - Pass `workspaceId` prop to Tasks component (needed for status queries)

### Routing
- **Added route:** `:projectId/tasks/:taskId` under projects path
- **Expand flow:** Sheet expand button → navigate to full-page route
- **Back flow:** Full-page back button → return to project view

## Technical Decisions

### BlockNote Integration
- **Editor initialization:** `useCreateBlockNote` with initialContent from task.description (parsed JSON)
- **CSS imports:** `@blocknote/core/fonts/inter.css` and `@blocknote/shadcn/style.css`
- **Component:** `<BlockNoteView>` with onChange handler
- **Storage:** Description stored as JSON.stringify(editor.document)
- **Debouncing:** 500ms timeout to batch rapid changes

### Property Editing Pattern
Each property has:
1. Select/Input component bound to task data
2. Change handler that calls `updateTask` mutation
3. Immediate update (via `void updateTask(...)`)
4. Convex reactivity updates UI automatically

**Example (status change):**
```typescript
const handleStatusChange = (statusId: Id<"taskStatuses">) => {
  void updateTask({ taskId, statusId });
};
```

### Labels Implementation
- **Storage:** Array of freeform strings (`task.labels`)
- **Add:** Input field + Enter key or Add button
- **Remove:** X button on each badge
- **Update:** Recreate array and call mutation

### TypeScript Fixes
- Removed unused `SheetTitle` import
- Added `void` operator for promise-returning handlers
- Proper typing for `selectedTaskId` state (`Id<"tasks"> | null`)
- ESLint disable for title effect dependency array (intentional partial update)

## Deviations from Plan

None - plan executed exactly as written.

## Integration Points

### Data Dependencies
- **Task data:** `api.tasks.get` (enriched with status and assignee)
- **Statuses:** `api.taskStatuses.listByWorkspace` (for dropdown)
- **Members:** `api.projectMembers.membersByProject` (for assignee dropdown)

### Mutations Used
- **Update:** `api.tasks.update` (all property changes)
- **Delete:** `api.tasks.remove` (with navigation after success)

### Navigation Flow
```
Project page → Click task → Sheet opens
  → Edit properties → Auto-saves
  → Click expand → Full-page view
    → Click back → Returns to project
  → Click delete → Confirms → Removes task → Closes sheet
```

## User Experience

### Side Panel (Primary Interface)
- **Trigger:** Click any task row in the list
- **Animation:** Slides in from right
- **Dismiss:** Click outside, press ESC, or click X button
- **Editing:** All properties editable inline, saves automatically
- **Expand:** Button navigates to full-page for more space

### Full-Page View (Secondary Interface)
- **Trigger:** Click expand button in sheet
- **Layout:** Larger, more spacious
- **Back:** Button returns to project task list
- **Same functionality:** All editing features work identically

### Real-time Sync
- Changes appear instantly in task list (Convex reactivity)
- Multiple users see updates live
- No explicit save button needed

## Next Phase Readiness

**Ready for:**
- Task comments (add section below description)
- Activity log (sidebar or tab)
- Attachments (file upload section)
- Subtasks (nested list)
- Time tracking (property + timer)

**Blocks:** None

**Risks:** None

**Dependencies satisfied:**
- 02-02 provides task list UI
- Status system from 02-01
- Project membership queries available

## Self-Check: PASSED

All files verified:
- ✓ src/pages/App/Project/TaskDetailSheet.tsx (created)
- ✓ src/pages/App/Project/TaskDetailPage.tsx (created)
- ✓ src/pages/App/Project/Tasks.tsx (modified)
- ✓ src/pages/App/Project/ProjectDetails.tsx (modified)
- ✓ src/routes.tsx (modified)

All commits verified:
- ✓ b6861e0 (feat(02-03): create task detail sheet with full property editing)
- ✓ 47f378c (feat(02-04): add My Tasks to sidebar and routing - includes Task 2 changes)

Note: Task 2 changes were committed by parallel plan 02-04 due to concurrent file modifications. All functionality is present and working.
