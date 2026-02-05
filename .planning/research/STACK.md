# Technology Stack: Task Management with Kanban Boards

**Project:** Ripple - Task Management Feature
**Researched:** 2026-02-05
**Confidence:** HIGH

## Executive Summary

For adding Kanban task management to your existing Convex/React workspace, the 2025-2026 standard stack is:
- **@dnd-kit** (v6.3.1 core, v10.0.0 sortable) for drag-and-drop
- **react-day-picker** (v9.13.0) via shadcn/ui for date selection
- **Convex native patterns** for optimistic updates and real-time sync
- **Fractional indexing** for task ordering without reindexing

This stack integrates seamlessly with your existing Convex 1.31.7, React 18, shadcn/ui foundation.

---

## Recommended Stack

### Drag-and-Drop System

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @dnd-kit/core | 6.3.1 | Core drag-drop primitives | Modern, actively maintained, 5.4M weekly downloads. Replaces deprecated react-beautiful-dnd |
| @dnd-kit/sortable | 10.0.0 | Kanban board sorting | Pre-built sortable presets for columns and cards |
| @dnd-kit/utilities | 3.2.2 | Helper utilities | CSS utilities and common transforms |

**Rationale:**
- react-beautiful-dnd is deprecated with no future maintenance planned (as of 2024)
- @dnd-kit is the 2025+ standard with 5.4M weekly downloads vs 1.9M for react-beautiful-dnd
- Supports accessibility (keyboard nav, screen readers), touch devices, virtualization
- Modular architecture fits with existing Convex patterns
- **Confidence: HIGH** - Verified via npm registry and multiple ecosystem surveys

**Key Features:**
- Built-in collision detection algorithms
- Customizable drag overlays
- Multiple droppable containers (Kanban columns)
- Smooth animations with physics-based motion
- Zero dependencies on deprecated libraries

### Date Management

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| react-day-picker | 9.13.0 | Date selection UI | Industry standard, powers shadcn/ui date picker |
| date-fns | 4.1.0 | Date manipulation | Lightweight, tree-shakeable, modern alternative to moment.js |

**Rationale:**
- Already using shadcn/ui components, which standardize on react-day-picker
- Maintains design consistency with existing Radix UI components
- date-fns is 2026 standard (moment.js deprecated in 2020)
- WCAG 2.1 AA compliant for accessibility
- **Confidence: HIGH** - Verified via npm registry

**Integration Pattern:**
```typescript
// Use existing shadcn/ui date picker pattern
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { format } from "date-fns"

// Task due date selector
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">
      {dueDate ? format(dueDate, "PPP") : "Pick a date"}
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-auto p-0">
    <Calendar
      mode="single"
      selected={dueDate}
      onSelect={setDueDate}
    />
  </PopoverContent>
</Popover>
```

### State Management & Real-Time Sync

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Convex (existing) | 1.31.7 | Backend, real-time DB | Already in use, handles subscriptions natively |
| convex-helpers | 0.1.111 | Validation, relationships | Already in use, provides Zod integration |

**Rationale:**
- No additional state management library needed (Redux, Zustand, etc.)
- Convex `useQuery` hooks provide reactive state automatically
- Built-in optimistic updates via `useMutation().withOptimisticUpdate()`
- Real-time sync is native, not bolted on
- **Confidence: HIGH** - Direct from your existing package.json

### Task Ordering & Positioning

| Approach | Implementation | Why |
|----------|---------------|-----|
| Fractional indexing | Custom utility or library | Enables reordering without cascading updates |

**Rationale:**
- Traditional integer positions require reindexing all tasks when inserting
- Fractional indexing (e.g., "a0", "a1", "a2" → insert "a0V" between "a0" and "a1") avoids this
- Lexicographic ordering: strings like "aaa", "aab", "aac" for infinite insertions
- Single mutation updates only the moved task's position field
- **Confidence: MEDIUM** - Pattern is well-documented but requires custom implementation

**Implementation Options:**
1. **fractional-indexing** npm package (recommended)
2. **Custom implementation** using lexicographic strings (see PITFALLS.md for edge cases)

---

## Supporting Libraries (Optional)

### Task Properties Enhancement

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| cmdk | 1.0.0 (existing) | Command palette | Quick task creation from anywhere |
| lucide-react | 0.462.0 (existing) | Icons | Priority badges, status indicators |
| class-variance-authority | 0.7.1 (existing) | Conditional styling | Priority colors, status badges |

**Note:** These are already in your project. Reuse for task management UI.

### Labels & Tags

| Approach | Implementation | Why |
|----------|---------------|-----|
| Array of strings | `labels: v.array(v.string())` | Simple, flexible, searchable with Convex indexes |

**Rationale:**
- Your existing schema uses this pattern for `documents.tags` and `diagrams.tags`
- Maintains consistency across workspace features
- Enables full-text search via Convex `searchIndex`

---

## Architecture Patterns

### 1. Optimistic Updates for Drag-Drop

**Pattern:** Use Convex `withOptimisticUpdate` to prevent UI jank during drag operations.

```typescript
// Example: Moving a task between columns
const moveTask = useMutation(api.tasks.move).withOptimisticUpdate(
  (localStore, args) => {
    const existingTasks = localStore.getQuery(api.tasks.list, {
      projectId: args.projectId
    });

    if (!existingTasks) return;

    // Optimistically update local state
    const updatedTasks = existingTasks.map(task =>
      task._id === args.taskId
        ? { ...task, status: args.newStatus, position: args.newPosition }
        : task
    );

    localStore.setQuery(
      api.tasks.list,
      { projectId: args.projectId },
      updatedTasks
    );
  }
);
```

**Why:** Prevents the jarring reversion when Convex revalidates after mutation completes. Essential for smooth drag-drop UX.

**Source:** [Convex Optimistic Updates Documentation](https://docs.convex.dev/client/react/optimistic-updates) (verified 2026-02-05)

### 2. Database Schema for Tasks

**Pattern:** Flat documents with relational IDs, following Convex best practices.

```typescript
// schema.ts
export default defineSchema({
  projects: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()), // For visual distinction
  }).index("by_workspace", ["workspaceId"]),

  tasks: defineTable({
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"), // Denormalized for efficient queries
    title: v.string(),
    description: v.optional(v.string()),
    status: v.string(), // "todo", "in_progress", "done", etc.
    priority: v.optional(v.string()), // "low", "medium", "high", "urgent"
    position: v.string(), // Fractional index for ordering within column
    dueDate: v.optional(v.number()), // Unix timestamp
    labels: v.optional(v.array(v.string())),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_status", ["projectId", "status"]) // Efficient column queries
    .index("by_workspace", ["workspaceId"])
    .index("by_assignee", ["assigneeId"]) // For user's task list
    .searchIndex("by_title", {
      searchField: "title",
      filterFields: ["projectId", "workspaceId"]
    }),

  taskAssignees: defineTable({
    taskId: v.id("tasks"),
    userId: v.id("users"),
    projectId: v.id("projects"), // Denormalized for queries
  })
    .index("by_task", ["taskId"])
    .index("by_user", ["userId"])
    .index("by_project", ["projectId"])
    .index("by_task_user", ["taskId", "userId"]), // Unique constraint via app logic
});
```

**Key Decisions:**
- **Many-to-many assignees:** Separate `taskAssignees` table (Convex best practice)
- **Denormalized `workspaceId`:** Enables direct workspace-level queries without joins
- **String positions:** Fractional indexing for efficient reordering
- **Indexes match query patterns:** `by_project_status` for Kanban columns, `by_assignee` for user views

**Confidence: HIGH** - Pattern matches your existing schema for channels, documents, and follows [Convex relationship guidelines](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas)

### 3. Real-Time Sync Strategy

**Pattern:** Convex subscriptions handle all real-time updates automatically.

```typescript
// TaskBoard.tsx
const tasks = useQuery(api.tasks.list, { projectId });

// Automatically updates when:
// - Current user moves a task (optimistic update → mutation → revalidation)
// - Another user moves a task (mutation → subscription update)
// - Task is created/deleted (subscription update)

// No WebSocket management needed!
```

**Why:** Convex's reactive subscriptions eliminate manual conflict resolution. Unlike CRDTs or OT algorithms, the server is source of truth and broadcasts changes via WebSocket.

**Conflict Resolution:** Last-write-wins at database level. For task movement, position strings prevent conflicts (each task has unique position).

**Confidence: HIGH** - This is Convex's core value proposition, already working for your messages and documents.

### 4. Drag-Drop Integration with @dnd-kit

**Pattern:** Combine @dnd-kit sensors with Convex mutations.

```typescript
import { DndContext, DragEndEvent, closestCorners } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

function KanbanBoard({ projectId }: { projectId: Id<"projects"> }) {
  const tasks = useQuery(api.tasks.list, { projectId });
  const moveTask = useMutation(api.tasks.move).withOptimisticUpdate(/* ... */);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Calculate new position using fractional indexing
    const newPosition = calculatePosition(tasks, active.id, over.id);

    // Mutation with optimistic update
    await moveTask({
      taskId: active.id as Id<"tasks">,
      projectId,
      newStatus: /* determine from over container */,
      newPosition,
    });
  };

  return (
    <DndContext onDragEnd={handleDragEnd} collisionDetection={closestCorners}>
      {columns.map(column => (
        <SortableContext
          id={column.id}
          items={tasks.filter(t => t.status === column.id)}
          strategy={verticalListSortingStrategy}
        >
          {/* Render tasks */}
        </SortableContext>
      ))}
    </DndContext>
  );
}
```

**Key Points:**
- `collisionDetection={closestCorners}` for multi-column detection
- `SortableContext` per column with filtered tasks
- Optimistic update prevents reorder animation jank
- Position calculation uses fractional indexing library

**Confidence: HIGH** - Pattern documented in [@dnd-kit Kanban examples](https://radzion.com/blog/kanban/) and [LogRocket guide](https://blog.logrocket.com/build-kanban-board-dnd-kit-react/)

---

## Installation

### New Dependencies

```bash
# Drag-and-drop
npm install @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2

# Date utilities (date-fns likely already installed)
npm install date-fns@4.1.0

# Fractional indexing
npm install fractional-indexing@3.2.0  # or implement custom
```

### Verify Existing Dependencies

These should already be in your project (from package.json):
- `convex@1.31.7`
- `convex-helpers@0.1.111`
- `react-day-picker` (via shadcn/ui calendar component)
- `zod@3.25.76` (for validators)
- `lucide-react@0.462.0` (for icons)
- `@radix-ui/*` components (for popovers, select, etc.)

---

## Alternatives Considered

### Drag-Drop Libraries

| Library | Why Not Recommended |
|---------|-------------------|
| react-beautiful-dnd | Deprecated, no maintenance since 2021. Official repo archived. |
| react-dnd | Overly complex for Kanban use case. Better for heterogeneous drag-drop (file uploads, multi-type draggables). Higher learning curve. |
| Pragmatic Drag and Drop (Atlassian) | New (2024), but less mature ecosystem. No React-specific presets. More low-level than needed. |
| HTML5 Drag and Drop API | Poor mobile support, inconsistent across browsers, requires significant boilerplate. |

**Verdict:** @dnd-kit is the 2025-2026 standard for React Kanban boards.

### Date Pickers

| Library | Why Not Recommended |
|---------|-------------------|
| react-datepicker | Requires additional CSS, less integrated with Tailwind/shadcn. Heavier bundle. |
| MUI X Date Pickers | Requires @mui/material dependency. Design inconsistency with shadcn/ui. |
| Airbnb react-dates | Older, less actively maintained. Designed for date ranges (travel booking), overkill for task due dates. |

**Verdict:** Stick with react-day-picker via shadcn/ui for consistency.

### State Management

| Approach | Why Not Recommended |
|----------|-------------------|
| Redux Toolkit | Unnecessary complexity when Convex provides reactive state. Would duplicate subscription logic. |
| Zustand | Simpler than Redux, but still redundant with Convex queries. Adds mental overhead of two state systems. |
| Jotai/Recoil | Atomic state useful for local UI, but Convex subscriptions already handle shared state. |

**Verdict:** Convex's `useQuery` + `useMutation` is sufficient. Only use local React state (`useState`) for ephemeral UI (modals, dropdowns).

### Task Ordering

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| Integer positions (1, 2, 3...) | Simple | Requires reindexing all tasks on insert | ❌ Avoid |
| Float positions (1.0, 2.0, 3.0) | Better than integers | Precision issues after many inserts | ❌ Avoid |
| Fractional indexing (strings) | Infinite insertions, single-task updates | Requires library or custom logic | ✅ Recommended |
| Linked list (prevId/nextId) | No position field needed | Complex queries, race conditions in real-time | ❌ Avoid |

**Verdict:** Fractional indexing (lexicographic strings) is the modern standard for collaborative ordering.

---

## Confidence Assessment

| Technology | Confidence | Rationale |
|-----------|-----------|-----------|
| @dnd-kit | HIGH | Verified latest versions via npm (6.3.1, 10.0.0). Multiple 2025-2026 ecosystem surveys confirm as standard. 5.4M weekly downloads. |
| react-day-picker | HIGH | Verified v9.13.0 via npm. Powers shadcn/ui, already in ecosystem. |
| date-fns | HIGH | Verified v4.1.0 via npm. Standard for 2025+ (moment.js deprecated). |
| Convex patterns | HIGH | Official documentation reviewed. Patterns match existing codebase (messages, documents). |
| Fractional indexing | MEDIUM | Well-documented pattern, but requires custom implementation or small library. Edge cases exist (see PITFALLS.md). |
| Optimistic updates | HIGH | Convex native feature, documented extensively. Used successfully for chat apps. |

**Overall Stack Confidence: HIGH**

All core technologies are verified via official sources and npm registry. Patterns align with existing Ripple architecture.

---

## Integration Notes

### Consistency with Existing Stack

This stack maintains consistency with your existing architecture:

| Feature | Existing Pattern | Task Management Pattern |
|---------|-----------------|------------------------|
| Real-time sync | Convex subscriptions (messages, presence) | Same for tasks |
| Data model | Flat tables with indexes (channels, documents) | Same for projects/tasks |
| UI components | shadcn/ui + Radix | Continue using for task UI |
| Form validation | Zod + convex-helpers | Same for task forms |
| Role-based access | WorkspaceRole, ChannelRole, DocumentRole | Add ProjectRole enum |
| Search | `searchIndex` on messages, documents | Add for task titles |

### Reusable Patterns

You can leverage existing patterns:
- **Membership model:** Copy `workspaceMembers` pattern for project members
- **Role counts:** Copy `channels.roleCount` for project access control
- **Search:** Copy `messages` search index pattern for task search
- **Optimistic updates:** Copy message creation pattern for task creation

---

## Next Steps

1. **Install dependencies** (see Installation section)
2. **Extend schema** with `projects`, `tasks`, `taskAssignees` tables
3. **Create fractional indexing utility** (or install library)
4. **Build basic Kanban board** with @dnd-kit
5. **Add optimistic updates** to drag-drop mutations
6. **Integrate task properties** (assignees, due dates, labels)
7. **Add deep integration** (embed docs/diagrams, create from chat)

---

## Sources

### Verified via Official Sources (HIGH Confidence)
- [@dnd-kit/core - npm](https://www.npmjs.com/package/@dnd-kit/core) - Version 6.3.1
- [@dnd-kit/sortable - npm](https://www.npmjs.com/package/@dnd-kit/sortable) - Version 10.0.0
- [react-day-picker - npm](https://www.npmjs.com/package/react-day-picker) - Version 9.13.0
- [Convex Optimistic Updates Documentation](https://docs.convex.dev/client/react/optimistic-updates)
- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/)
- [Convex Relationship Structures](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas)

### Ecosystem Surveys (MEDIUM-HIGH Confidence)
- [Top 5 Drag-and-Drop Libraries for React in 2026](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react)
- [Comparison with react-beautiful-dnd - GitHub Discussion](https://github.com/clauderic/dnd-kit/discussions/481)
- [Building a Drag-and-Drop Kanban Board with React and dnd-kit](https://radzion.com/blog/kanban/)
- [Build a Kanban board with dnd kit and React - LogRocket](https://blog.logrocket.com/build-kanban-board-dnd-kit-react/)

### Patterns and Best Practices (MEDIUM Confidence)
- [Database Relationship Helpers - Convex](https://stack.convex.dev/functional-relationships-helpers)
- [Kanban board column indexing mechanism](https://nickmccleery.com/posts/08-kanban-indexing/)
- [Convex Helpers - Zod Validation](https://github.com/get-convex/convex-helpers)

---

**Last Updated:** 2026-02-05
**Next Review:** When adding advanced features (e.g., subtasks, dependencies, time tracking)
