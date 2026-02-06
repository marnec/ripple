# Phase 3: Kanban Board View - Research

**Researched:** 2026-02-06
**Domain:** Real-time collaborative Kanban board with drag-and-drop
**Confidence:** HIGH

## Summary

A Kanban board visualizes tasks in status columns with drag-and-drop reordering. The standard React approach uses **dnd-kit** (modern, accessible, performant) with **fractional indexing** for efficient ordering. Convex provides real-time updates automatically via reactive queries, while **optimistic updates** make drag operations feel instant.

**Key findings:**
- **dnd-kit** is the current standard (react-beautiful-dnd is unmaintained)
- **@dnd-kit/sortable** preset handles multi-container Kanban patterns
- **Fractional indexing** enables O(1) reordering (only moved item updates)
- **Convex optimistic updates** make drag-and-drop instant with auto-rollback
- **shadcn/ui** has official Kanban component patterns with dnd-kit integration

**Primary recommendation:** Use dnd-kit's sortable preset with fractional-indexing library for task ordering, leverage Convex's reactive queries for real-time updates, and implement optimistic updates for drag operations.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @dnd-kit/core | 6.x | Drag-and-drop foundation | Modern, accessible, performant (10kb, no deps) |
| @dnd-kit/sortable | 8.x | Multi-container sorting | Standard preset for Kanban boards |
| fractional-indexing | 3.x | Task ordering | O(1) reordering, no database reindexing needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @dnd-kit/utilities | 3.x | Helper utilities | CSS transforms, array manipulation |
| @dnd-kit/modifiers | 7.x | Drag constraints | Snap-to-grid, axis locking (optional) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| dnd-kit | react-beautiful-dnd | **Don't use**: Unmaintained by Atlassian, no future development |
| dnd-kit | Pragmatic Drag and Drop | Newer, smaller bundle, but less React-idiomatic and smaller ecosystem |
| fractional-indexing | LexoRank | More complex bucketing system, overkill for typical use case |
| fractional-indexing | Integer reordering | Requires updating all items between positions (O(n) instead of O(1)) |

**Installation:**
```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities fractional-indexing
```

## Architecture Patterns

### Recommended Project Structure
```
src/pages/App/Project/
├── KanbanBoard.tsx          # Main board page component
├── KanbanColumn.tsx         # Status column with droppable area
├── KanbanCard.tsx           # Task card (draggable + presentational)
└── components/
    ├── KanbanCardPresenter.tsx  # Presentational card (used in overlay)
    └── AddColumnDialog.tsx      # Dialog for adding custom columns
```

### Pattern 1: Multi-Container Sortable Board
**What:** Tasks organized in status columns, draggable between columns and within columns

**When to use:** Standard Kanban board (this phase)

**Example:**
```typescript
// Source: https://docs.dndkit.com/presets/sortable
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

function KanbanBoard() {
  const [activeId, setActiveId] = useState(null);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {columns.map((column) => (
        <SortableContext
          key={column.id}
          items={column.taskIds}
          strategy={verticalListSortingStrategy}
        >
          <KanbanColumn column={column} />
        </SortableContext>
      ))}

      <DragOverlay>
        {activeId ? <KanbanCardPresenter id={activeId} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
```

### Pattern 2: Fractional Indexing for Task Order
**What:** String-based position values that enable O(1) insertion without reindexing

**When to use:** Task reordering within columns

**Example:**
```typescript
// Source: https://github.com/rocicorp/fractional-indexing
import { generateKeyBetween } from 'fractional-indexing';

// Insert task between two others
const newPosition = generateKeyBetween(
  tasks[index - 1]?.position ?? null,  // before
  tasks[index]?.position ?? null        // after
);

await updateTask({ taskId, position: newPosition });
```

### Pattern 3: Convex Optimistic Updates for Drag
**What:** Immediate UI update before server confirmation, auto-rollback on failure

**When to use:** Drag-and-drop status/position changes

**Example:**
```typescript
// Source: https://docs.convex.dev/client/react/optimistic-updates
const updateTaskStatus = useMutation(api.tasks.update)
  .withOptimisticUpdate((localStore, args) => {
    // Update local query results immediately
    const currentTasks = localStore.getQuery(api.tasks.listByProject, {
      projectId
    });

    if (currentTasks !== undefined) {
      const updatedTasks = currentTasks.map(task =>
        task._id === args.taskId
          ? { ...task, statusId: args.statusId, position: args.position }
          : task
      );
      localStore.setQuery(
        api.tasks.listByProject,
        { projectId },
        updatedTasks
      );
    }
  });
```

### Pattern 4: Decoupled Presentational Components for DragOverlay
**What:** Separate draggable wrapper from presentational component

**When to use:** Always with DragOverlay (prevents duplicate IDs and useSortable hook conflicts)

**Example:**
```typescript
// Source: https://docs.dndkit.com/api-documentation/draggable/drag-overlay

// Presentational component (no hooks)
function KanbanCardPresenter({ task }) {
  return (
    <Card>
      <CardHeader>{task.title}</CardHeader>
      {/* ... */}
    </Card>
  );
}

// Draggable wrapper (with useSortable)
function KanbanCard({ task }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: task._id
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <KanbanCardPresenter task={task} />
    </div>
  );
}
```

### Pattern 5: Sensor Configuration for Click vs Drag
**What:** Configure PointerSensor to distinguish clicks from drags

**When to use:** Cards are both clickable (open detail) and draggable

**Example:**
```typescript
// Source: https://docs.dndkit.com
import { PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

const sensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: {
      distance: 8, // 8px movement before drag starts (allows clicks)
    },
  }),
  useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  })
);
```

### Anti-Patterns to Avoid

- **Rendering same component twice in DragOverlay:** Creates duplicate IDs and hook conflicts. Use separate presentational component.
- **Using filter() instead of withIndex() for Convex queries:** Phase 2 established indexed queries pattern.
- **Re-indexing all items on reorder:** Use fractional indexing instead of sequential integers.
- **Not using optimistic updates for drag:** Makes UX feel laggy (wait for server roundtrip).
- **Calling mutations from mutations:** Phase 2 established inline logic pattern.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-and-drop | Custom pointer event handlers | @dnd-kit/core + @dnd-kit/sortable | Accessibility, touch support, keyboard nav, collision detection all built-in |
| Task ordering | Sequential integer positions | fractional-indexing library | O(1) reordering vs O(n), no conflicts in concurrent edits |
| Column reordering | Manual position swap logic | Same fractional-indexing pattern | Consistent ordering approach across board |
| Optimistic updates | Manual state sync + rollback | Convex .withOptimisticUpdate() | Auto-rollback, reactive, handles race conditions |
| Drag overlay rendering | Position calculations | @dnd-kit DragOverlay component | Handles viewport positioning, animations, z-index |

**Key insight:** Drag-and-drop has complex edge cases (touch vs mouse, accessibility, collision detection, auto-scrolling, nested containers). dnd-kit solves these. Fractional indexing prevents expensive re-indexing operations that become bottlenecks in real-time collaboration.

## Common Pitfalls

### Pitfall 1: Performance Degradation with Many Items
**What goes wrong:** Every drag causes re-render of all sortable items if not optimized

**Why it happens:** useSortable hook triggers re-render on every drag event

**How to avoid:**
- Memoize KanbanCard components with React.memo
- Keep presentational logic separate from drag logic
- Limit items per column (virtualize if >50 items)
- Use CSS transforms (translate3d, scale) not layout properties

**Warning signs:** Laggy drag operations, dropped frames during drag

### Pitfall 2: Fractional Index Precision Exhaustion
**What goes wrong:** After many re-orders between same two items, precision runs out

**Why it happens:** JavaScript numbers have 52-bit precision, averaging positions eventually converges

**How to avoid:**
- Use string-based fractional indexing (not floats)
- fractional-indexing library handles this automatically with variable-length strings
- Monitor position string length, rebalance if strings exceed 20 characters (rare)

**Warning signs:** Position strings getting very long (>20 chars), duplicate positions

### Pitfall 3: Optimistic Update Mismatch with Server State
**What goes wrong:** UI shows wrong state after server mutation completes

**Why it happens:** Optimistic update structure doesn't match server return shape

**How to avoid:**
- Match enriched query structure exactly (include status, assignee nested objects)
- Test optimistic update rollback by simulating failures
- Use existing query patterns from Phase 2 (enriched returns)

**Warning signs:** UI flickers after drag completes, tasks disappear then reappear

### Pitfall 4: Drag Between Columns Not Detected
**What goes wrong:** Can't drag tasks between status columns

**Why it happens:** Missing onDragOver handler to update column membership during drag

**How to avoid:**
- Implement onDragOver to track active container changes
- Use closestCenter or closestCorners collision detection
- Update local state when task moves between columns

**Warning signs:** Tasks snap back to origin column, can only drag within column

### Pitfall 5: Race Conditions in Concurrent Edits
**What goes wrong:** Two users drag same task, one change gets lost

**Why it happens:** Last write wins without conflict detection

**How to avoid:**
- Convex handles this automatically with ACID transactions
- Optimistic updates roll back on conflict
- Don't try to implement custom conflict resolution

**Warning signs:** Changes disappearing in multi-user testing

### Pitfall 6: Accessibility - Keyboard Users Can't Navigate
**What goes wrong:** Keyboard users can't drag tasks

**Why it happens:** Only configured PointerSensor, no KeyboardSensor

**How to avoid:**
- Always include KeyboardSensor with sortableKeyboardCoordinates
- Test with Tab + Space/Enter to activate drag, arrow keys to move

**Warning signs:** Can't drag without mouse, screen reader doesn't announce drag state

## Code Examples

### Example 1: Complete Drag Handlers
```typescript
// Source: https://radzion.com/blog/kanban/ + Convex patterns
function KanbanBoard() {
  const [activeDrag, setActiveDrag] = useState<{
    taskId: string;
    originalStatusId: string;
  } | null>(null);

  const updateTask = useMutation(api.tasks.update)
    .withOptimisticUpdate((localStore, { taskId, statusId, position }) => {
      const tasks = localStore.getQuery(api.tasks.listByProject, { projectId });
      if (!tasks) return;

      const updated = tasks.map(task =>
        task._id === taskId
          ? { ...task, statusId, position, status: getStatus(statusId) }
          : task
      );
      localStore.setQuery(api.tasks.listByProject, { projectId }, updated);
    });

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const task = findTask(active.id);

    setActiveDrag({
      taskId: active.id as string,
      originalStatusId: task.statusId,
    });
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeStatusId = findTask(active.id).statusId;
    const overStatusId = over.data.current?.sortable?.containerId || over.id;

    if (activeStatusId !== overStatusId) {
      // Task moving between columns - update local state for visual feedback
      // Final position calculation happens in handleDragEnd
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !activeDrag) return;

    const newStatusId = over.data.current?.sortable?.containerId || over.id;
    const overIndex = over.data.current?.sortable?.index ?? 0;

    // Get tasks in new column
    const columnTasks = getTasksByStatus(newStatusId);

    // Calculate new position using fractional indexing
    const beforeTask = columnTasks[overIndex - 1];
    const afterTask = columnTasks[overIndex];

    const newPosition = generateKeyBetween(
      beforeTask?.position ?? null,
      afterTask?.position ?? null
    );

    // Update with optimistic feedback
    await updateTask({
      taskId: active.id as string,
      statusId: newStatusId,
      position: newPosition,
    });

    setActiveDrag(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {/* columns */}
    </DndContext>
  );
}
```

### Example 2: Convex Schema for Ordering
```typescript
// Add to tasks table in schema.ts
tasks: defineTable({
  // ... existing fields
  position: v.string(), // fractional index for ordering within status column
})
  .index("by_project_status_position", ["projectId", "statusId", "position"])
```

### Example 3: Query Tasks Ordered by Position
```typescript
// convex/tasks.ts - New query for Kanban board
export const listByProjectKanban = query({
  args: {
    projectId: v.id("projects"),
    hideCompleted: v.optional(v.boolean()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, { projectId, hideCompleted }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Validate project membership
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", projectId).eq("userId", userId)
      )
      .first();

    if (!membership) return [];

    // Get tasks ordered by position within each status
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    // Filter completed if requested
    const filteredTasks = hideCompleted
      ? tasks.filter(t => !t.completed)
      : tasks;

    // Enrich with status
    const enriched = await Promise.all(
      filteredTasks.map(async (task) => ({
        ...task,
        status: await ctx.db.get(task.statusId),
        assignee: task.assigneeId ? await ctx.db.get(task.assigneeId) : null,
      }))
    );

    // Sort by position within each status (client can group)
    return enriched.sort((a, b) => {
      if (a.statusId !== b.statusId) return 0; // different statuses
      return (a.position ?? '').localeCompare(b.position ?? '');
    });
  },
});
```

### Example 4: shadcn/ui Kanban Card Component
```typescript
// Source: https://marmelab.com/blog/2026/01/15/building-a-kanban-board-with-shadcn.html
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

function KanbanCardPresenter({ task }) {
  return (
    <Card className="cursor-grab active:cursor-grabbing">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{task.title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center justify-between">
          <Badge variant={getPriorityVariant(task.priority)}>
            {task.priority}
          </Badge>
          {task.assignee && (
            <Avatar className="h-6 w-6">
              <AvatarFallback className="text-xs">
                {task.assignee.name?.[0] || "?"}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| react-beautiful-dnd | @dnd-kit | 2021-2023 transition | Must use dnd-kit for new projects, rbd unmaintained |
| Integer positions (1, 2, 3...) | Fractional indexing (string keys) | 2020-2022 | O(1) reordering, better for real-time collaboration |
| HTML5 Drag and Drop API | Abstraction libraries | Ongoing | Touch support, accessibility, cross-browser consistency |
| Manual optimistic updates | Framework-provided patterns | 2023+ (Convex) | Simpler code, automatic rollback |
| Global state (Redux/Zustand) for drag | Library-managed state | 2020+ (dnd-kit) | Less boilerplate, built-in optimizations |

**Deprecated/outdated:**
- **react-beautiful-dnd**: Unmaintained since 2021, no TypeScript improvements, no future development
- **react-dnd**: Still maintained but heavier, more complex API, less React-idiomatic
- **Float-based fractional indexing**: Precision issues, use string-based implementations instead
- **Mutation-calling-mutation pattern**: Established in Phase 2 that Convex mutations can't call mutations

## Open Questions

### Question 1: Column Reordering Persistence
**What we know:** taskStatuses table has `order` field (integer) for column display order
**What's unclear:** Whether to migrate to fractional indexing for column order or keep integer (columns reorder less frequently)
**Recommendation:** Keep integer `order` for columns (simpler, reordered rarely), use fractional indexing only for tasks (reordered constantly). Update column order by reassigning sequential integers.

### Question 2: Initial Position Values for New Tasks
**What we know:** fractional-indexing library can generate initial position with `generateKeyBetween(null, null)`
**What's unclear:** Best practice for default position (start of list, end of list, middle)
**Recommendation:** Add to end of default status column - call `generateKeyBetween(lastTask.position, null)` in tasks.create mutation

### Question 3: Real-time Position Conflicts
**What we know:** Convex handles ACID transactions, optimistic updates roll back on conflict
**What's unclear:** How to communicate conflict to user (silent rollback vs notification)
**Recommendation:** Start with silent rollback (Convex default). Monitor if users report "drag didn't work" issues, then add toast notification on rollback if needed.

## Sources

### Primary (HIGH confidence)
- [dnd-kit Official Documentation](https://docs.dndkit.com) - Core concepts, API reference
- [dnd-kit Sortable Preset](https://docs.dndkit.com/presets/sortable) - Multi-container patterns
- [Convex Optimistic Updates](https://docs.convex.dev/client/react/optimistic-updates) - Optimistic update patterns
- [Convex Realtime Documentation](https://docs.convex.dev/realtime) - Real-time subscription behavior
- [fractional-indexing GitHub](https://github.com/rocicorp/fractional-indexing) - Ordering algorithm

### Secondary (MEDIUM confidence)
- [LogRocket: Build Kanban with dnd-kit](https://blog.logrocket.com/build-kanban-board-dnd-kit-react/) - Multi-column implementation patterns
- [Marmelab: Kanban with shadcn/ui](https://marmelab.com/blog/2026/01/15/building-a-kanban-board-with-shadcn.html) - shadcn component integration
- [Radzion: Kanban with dnd-kit](https://radzion.com/blog/kanban/) - State management and drag handling
- [shadcn/ui Kanban Component](https://www.shadcn.io/components/data/kanban) - Official component patterns
- [GitHub: react-dnd-kit-tailwind-shadcn-ui](https://github.com/Georgegriff/react-dnd-kit-tailwind-shadcn-ui) - Reference implementation

### Tertiary (LOW confidence - community observations)
- [dnd-kit Performance Issues (#943)](https://github.com/clauderic/dnd-kit/issues/943) - Community reports on large lists
- [dnd-kit Unnecessary Rerenders (#389)](https://github.com/clauderic/dnd-kit/issues/389) - Performance pitfall discussions
- [Top 5 Drag-and-Drop Libraries 2026](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react) - Library comparison
- [Fractional Indexing Explained](https://hollos.dev/blog/fractional-indexing-a-solution-to-sorting/) - Algorithm overview
- [Figma: Realtime Editing of Ordered Sequences](https://www.figma.com/blog/realtime-editing-of-ordered-sequences/) - Production use case (content not fully accessible)

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** - dnd-kit is established standard (2M+ weekly downloads), fractional-indexing proven in production (Figma, Linear)
- Architecture: **HIGH** - Patterns verified in official docs and multiple production implementations
- Pitfalls: **MEDIUM** - Based on GitHub issues and community reports, not all tested in Convex context
- Convex integration: **HIGH** - Official Convex docs, existing Phase 2 patterns established

**Research date:** 2026-02-06
**Valid until:** ~30 days (dnd-kit stable, Convex patterns stable, React 18 stable)

**Key dependencies:**
- Existing task model from Phase 2 (statusId, projectId, enriched queries)
- shadcn/ui components (Card, Badge, Avatar already in use)
- Convex mutation patterns (can't call mutations from mutations, optimistic updates)
- React Router patterns (routes.tsx for Kanban page route)
