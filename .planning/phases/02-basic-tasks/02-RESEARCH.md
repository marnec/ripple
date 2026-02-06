# Phase 2: Basic Tasks - Research

**Researched:** 2026-02-06
**Domain:** Task management with Convex backend, React UI, BlockNote rich text editing
**Confidence:** HIGH

## Summary

Phase 2 implements core task CRUD within projects using established patterns from the existing codebase. The research confirms that Convex provides robust patterns for task management with indexed queries, optimistic updates, and real-time reactivity. BlockNote is already integrated at version 0.46.2 and ready for task descriptions. The UI will follow Linear/GitHub Issues patterns with compact list views and side panel details using shadcn Sheet component.

Key findings: (1) Convex compound indexes are critical for efficient filtering by project+status+assignee, (2) Status customization requires a separate table architecture with proper relationships, (3) Sheet component exists for side panels, but Badge component needs to be added, (4) React Hook Form + Zod validation pattern is already established in the codebase.

**Primary recommendation:** Use compound indexes on tasks table for all filter combinations, implement status as a separate customizable entity with default seed data, leverage existing shadcn components with Sheet for side panel, and add Badge for status indicators.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Task creation & editing flow:**
- Quick inline add in the task list (title only, hit Enter) for fast capture
- Clicking a task opens a side panel (slides in from right) with full detail and editing
- Side panel has an expand option to go to a dedicated full page
- Full BlockNote editor for task descriptions (same rich editor as Documents)
- All properties available during creation (status, priority, assignee, labels) — user fills what they want

**Task list view:**
- Compact list layout (stacked rows with title + key metadata inline, like GitHub Issues)
- No default grouping — flat list sorted by creation date
- Each row shows: title, status (colored badge), priority (icon), assignee (avatar)
- Labels visible in detail panel only, not in list rows
- Completed tasks hidden by default with a filter toggle at the top to show/hide them

**My Tasks (cross-project):**
- Accessible from sidebar as a dedicated page, plus each project can filter to user's tasks
- Grouped by project with collapsible sections
- No filtering or sorting for v1 — just the grouped list
- Clicking a task opens the detail side panel in-place (stays on My Tasks page, doesn't navigate to project)

### Claude's Discretion

**Creation modal:**
- User reconsidered the creation modal since the side panel handles full editing
- Claude decides whether inline add alone is sufficient, or if a lightweight modal adds value for the "create with properties upfront" flow
- Key consideration: inline add only captures title — if users often want to set properties at creation time, a modal or immediate side-panel-open may be needed

**Unspecified UI decisions:**
- Task row hover/selection styling
- Status badge colors and priority icon design
- Default sort order within project task lists
- Empty state design for tasks (per-project and My Tasks)
- Task deletion confirmation pattern
- How labels work (predefined set, freeform tags, or colored labels)
- Status column customization UI (success criteria #5 requires customizable columns)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

## Standard Stack

### Core Dependencies (Already in package.json)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **convex** | 1.31.7 | Backend database, queries, mutations | Existing backend, reactive real-time updates |
| **react-hook-form** | 7.71.1 | Form state management | Already used in CreateProjectDialog pattern |
| **zod** | 3.25.76 | Schema validation | Pairs with react-hook-form via @hookform/resolvers |
| **@blocknote/core** | 0.46.2 | Rich text editor core | Already integrated for Documents |
| **@blocknote/react** | 0.46.2 | React bindings for BlockNote | Already integrated |
| **@blocknote/shadcn** | 0.46.2 | shadcn UI integration | Matches existing shadcn design system |
| **lucide-react** | 0.563.0 | Icon library | Existing icon system (priority icons, etc.) |

### UI Components (shadcn - Already Available)

| Component | Available | Purpose |
|-----------|-----------|---------|
| **Sheet** | ✅ Yes | Side panel for task details |
| **Form** | ✅ Yes | Form wrapper with react-hook-form |
| **Input** | ✅ Yes | Text inputs for title |
| **Textarea** | ✅ Yes | Fallback for descriptions |
| **Select** | ✅ Yes | Status, priority, assignee dropdowns |
| **Button** | ✅ Yes | Actions and submissions |
| **Avatar** | ✅ Yes | Assignee avatars |
| **Dialog** | ✅ Yes | Optional creation modal |
| **Badge** | ❌ **MISSING** | Status indicators in list rows |
| **Checkbox** | ✅ Yes | Completed task toggle |
| **Tooltip** | ✅ Yes | Icon explanations |
| **Separator** | ✅ Yes | Visual dividers |

### Missing Components to Add

```bash
# Add Badge component for status indicators
npx shadcn@latest add badge
```

### Installation
All core dependencies already installed. Only Badge component needs to be added via shadcn CLI.

---

## Architecture Patterns

### Recommended Project Structure

```
src/pages/App/Project/
├── Tasks.tsx              # Main task list view for a project
├── TaskRow.tsx            # Individual task row in list
├── TaskDetailSheet.tsx    # Side panel for task details/editing
├── CreateTaskInline.tsx   # Inline title-only creation component
├── MyTasks.tsx            # Cross-project "My Tasks" view
└── TaskForm.tsx           # Shared form logic for task properties

convex/
├── tasks.ts               # Task CRUD operations (create, update, delete, queries)
├── taskStatuses.ts        # Status CRUD and default seeding
├── taskLabels.ts          # Label CRUD operations
└── schema.ts              # Extended with tasks, taskStatuses, taskLabels tables

shared/enums/
└── taskPriority.ts        # Priority enum (URGENT, HIGH, MEDIUM, LOW)
```

### Pattern 1: Convex Compound Indexes for Multi-Field Filtering

**What:** Define compound indexes in schema for efficient task queries by project, status, assignee, and completion state.

**When to use:** Always for task queries — filtering by single fields is common (project tasks, my tasks, status filter).

**Example:**
```typescript
// Source: Context7 - /llmstxt/convex_dev_llms-full_txt
// convex/schema.ts
export default defineSchema({
  tasks: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()), // BlockNote JSON content
    statusId: v.id("taskStatuses"), // Reference to customizable status
    assigneeId: v.optional(v.id("users")),
    priority: v.union(
      v.literal("urgent"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low")
    ),
    completed: v.boolean(),
    workspaceId: v.id("workspaces"), // Denormalized for cross-workspace queries
  })
    .index("by_project", ["projectId"])
    .index("by_project_completed", ["projectId", "completed"]) // Filter completed/incomplete
    .index("by_assignee", ["assigneeId"])
    .index("by_assignee_completed", ["assigneeId", "completed"]) // My Tasks with hide completed
    .index("by_project_status", ["projectId", "statusId"]) // Filter by status in project
    .index("by_workspace", ["workspaceId"]), // For cross-project queries

  taskStatuses: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(), // "To Do", "In Progress", "Done"
    color: v.string(), // Tailwind class like "bg-blue-500" or hex
    order: v.number(), // Display order (0, 1, 2...)
    isDefault: v.boolean(), // Default status for new tasks
    isCompleted: v.boolean(), // Marks task as completed when set
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_order", ["workspaceId", "order"]), // Ordered list

  taskLabels: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    color: v.string(), // Tailwind class or hex
  })
    .index("by_workspace", ["workspaceId"]),

  taskLabelAssignments: defineTable({
    taskId: v.id("tasks"),
    labelId: v.id("taskLabels"),
  })
    .index("by_task", ["taskId"])
    .index("by_label", ["labelId"]),
});
```

**Query with compound index:**
```typescript
// Source: Context7 - /llmstxt/convex_dev_llms-full_txt
// Get incomplete tasks for a project
export const listProjectTasks = query({
  args: {
    projectId: v.id("projects"),
    hideCompleted: v.boolean(),
  },
  returns: v.array(v.any()),
  handler: async (ctx, { projectId, hideCompleted }) => {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project_completed", (q) =>
        q.eq("projectId", projectId).eq("completed", hideCompleted ? false : undefined)
      )
      .collect();
    return tasks;
  },
});
```

### Pattern 2: React Hook Form with Zod Validation

**What:** Use react-hook-form for task property forms with Zod schema validation.

**When to use:** Task creation dialogs, task detail editing, inline forms.

**Example:**
```typescript
// Source: Codebase pattern from CreateProjectDialog.tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const taskFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  statusId: v.id("taskStatuses"),
  assigneeId: v.optional(v.id("users")),
  priority: z.enum(["urgent", "high", "medium", "low"]),
  labelIds: z.array(v.id("taskLabels")).optional(),
});

export function TaskForm() {
  const form = useForm<z.infer<typeof taskFormSchema>>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: "",
      priority: "medium",
    },
  });

  // ... form rendering with FormField components
}
```

### Pattern 3: shadcn Sheet for Side Panel Details

**What:** Use Sheet component for task detail panel that slides in from right, keeping list visible behind it.

**When to use:** Task detail view, inline editing without full-page navigation.

**Example:**
```typescript
// Pattern based on codebase shadcn usage
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function TaskDetailSheet({ taskId, open, onOpenChange }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[600px] sm:w-[800px] sm:max-w-none">
        <SheetHeader>
          <SheetTitle>Task Details</SheetTitle>
        </SheetHeader>
        {/* Task form and BlockNote editor */}
      </SheetContent>
    </Sheet>
  );
}
```

### Pattern 4: BlockNote for Rich Task Descriptions

**What:** Use BlockNote editor (already integrated) for task descriptions with same setup as Documents.

**When to use:** Task detail panel for description editing.

**Example:**
```typescript
// Source: Context7 - /websites/blocknotejs
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

export function TaskDescriptionEditor({ initialContent, onChange }) {
  const editor = useCreateBlockNote({
    initialContent: initialContent ? JSON.parse(initialContent) : undefined,
  });

  // Listen for changes
  useEffect(() => {
    editor.onEditorContentChange(() => {
      const content = JSON.stringify(editor.document);
      onChange(content);
    });
  }, [editor, onChange]);

  return <BlockNoteView editor={editor} />;
}
```

### Pattern 5: Optimistic Updates for Task Mutations

**What:** Apply optimistic updates to task mutations for instant UI feedback before server confirmation.

**When to use:** Task creation, status changes, property updates, deletion.

**Example:**
```typescript
// Source: Context7 - /llmstxt/convex_dev_llms-full_txt
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

export function TaskStatusButton({ taskId, projectId, newStatusId }) {
  const updateStatus = useMutation(api.tasks.updateStatus).withOptimisticUpdate(
    (localStore, args) => {
      const { taskId, statusId } = args;
      const existingTasks = localStore.getQuery(api.tasks.listProjectTasks, {
        projectId,
        hideCompleted: false,
      });

      if (existingTasks !== undefined) {
        const updatedTasks = existingTasks.map(task =>
          task._id === taskId ? { ...task, statusId } : task
        );
        localStore.setQuery(
          api.tasks.listProjectTasks,
          { projectId, hideCompleted: false },
          updatedTasks
        );
      }
    },
  );

  return (
    <button onClick={() => updateStatus({ taskId, statusId: newStatusId })}>
      Change Status
    </button>
  );
}
```

### Pattern 6: Customizable Task Statuses with Seeding

**What:** Store task statuses as separate entities in database with workspace-scoped defaults.

**When to use:** Initial workspace setup, status management UI (Phase 3+).

**Example:**
```typescript
// convex/taskStatuses.ts
export const seedDefaultStatuses = mutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    const existingStatuses = await ctx.db
      .query("taskStatuses")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();

    if (existingStatuses) return; // Already seeded

    // Create default statuses
    await ctx.db.insert("taskStatuses", {
      workspaceId,
      name: "To Do",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });

    await ctx.db.insert("taskStatuses", {
      workspaceId,
      name: "In Progress",
      color: "bg-blue-500",
      order: 1,
      isDefault: false,
      isCompleted: false,
    });

    await ctx.db.insert("taskStatuses", {
      workspaceId,
      name: "Done",
      color: "bg-green-500",
      order: 2,
      isDefault: false,
      isCompleted: true,
    });
  },
});
```

### Anti-Patterns to Avoid

- **Filtering with .filter() instead of indexes:** Always use `.withIndex()` for queries. Filtering after collection scans entire table.
- **Hardcoding status values:** Store statuses in database for customization. Don't use enum literals for status.
- **Mutable optimistic updates:** Always create new arrays/objects (`[...existing, new]`) rather than mutating (`existing.push(new)`) to prevent state corruption.
- **Loading all tasks upfront:** Use pagination or virtual scrolling for large task lists (see "Don't Hand-Roll" section).
- **Nested forms without proper composition:** Use react-hook-form's `useFormContext` or controlled components for nested forms like label selection.

---

## Don't Hand-Roll

### Problems with Existing Solutions

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| **Virtual scrolling for large task lists** | Custom scroll position tracking, DOM element pooling | Tanstack Virtual (TanStack Table v8) | Handles edge cases: variable row heights, scroll restoration, momentum scrolling, keyboard navigation. Current industry standard (Nov 2024+). |
| **Rich text editing** | Custom contentEditable implementation | BlockNote (already integrated) | WYSIWYG editing, block-based structure, extensibility, accessibility, undo/redo, copy/paste handling. |
| **Drag-and-drop task reordering** | Mouse event handlers for dragging | @dnd-kit/core | Handles touch devices, keyboard accessibility, auto-scrolling, collision detection, screen reader support. |
| **Date/time pickers** | Manual calendar UI | Radix UI date picker or shadcn calendar | Timezone handling, localization, keyboard navigation, accessibility (ARIA). |
| **Form validation** | Manual field validation logic | Zod + react-hook-form | Type safety, async validation, field dependencies, error messaging, touched/dirty state. |

**Key insight:** Task management systems have deceptive complexity in UX details. Virtual scrolling, drag-drop, rich text, and form state all have numerous edge cases that libraries have solved through years of production use and accessibility testing. Investing time in library integration yields better UX than custom implementations.

---

## Common Pitfalls

### Pitfall 1: Missing Compound Indexes for Common Queries

**What goes wrong:** Queries that filter by multiple fields (project + completed, assignee + completed) perform full table scans without proper indexes, leading to slow queries as task count grows.

**Why it happens:** Developers add indexes for single fields but forget that Convex requires explicit compound indexes for multi-field filters.

**How to avoid:**
- Define compound indexes for every common query pattern in schema.ts
- Use naming convention: `by_field1_field2` (e.g., `by_project_completed`)
- Test with large datasets (1000+ tasks) to verify query performance
- Review Convex query patterns: always use `.withIndex()` instead of `.filter()`

**Warning signs:**
- Slow task list loading with 100+ tasks
- Console warnings about missing indexes in Convex dashboard
- Queries using `.filter()` in convex function code

### Pitfall 2: Status as Enum Instead of Database Entity

**What goes wrong:** Hardcoding task statuses as TypeScript enums prevents users from customizing workflows (requirement TASK-04: "customizable columns").

**Why it happens:** Enums seem simpler for initial implementation, and developers follow patterns from WorkspaceRole/ChannelRole enums in existing codebase.

**How to avoid:**
- Store statuses in `taskStatuses` table with workspace relationship
- Seed default statuses on workspace creation
- Use `statusId: v.id("taskStatuses")` instead of status enum
- Build status management UI early (even if basic) to validate architecture

**Warning signs:**
- TypeScript enum definition for task status
- No `taskStatuses` table in schema
- Status customization UI blocked on "architecture refactor"

### Pitfall 3: BlockNote Content Storage Mismatch

**What goes wrong:** Storing BlockNote content as HTML or markdown instead of native JSON format causes content corruption, loss of custom blocks, and inconsistent rendering.

**Why it happens:** Developers assume HTML/markdown is simpler for database storage and editing.

**How to avoid:**
- Store BlockNote content as **JSON string** in database (`v.string()` field)
- Use `JSON.stringify(editor.document)` to serialize
- Use `JSON.parse(content)` to deserialize for `initialContent`
- Never convert to HTML/markdown for storage (only for export/display)

**Warning signs:**
- Database column typed as `v.optional(v.string())` with HTML content
- Custom blocks (tables, embeds) lost on reload
- Formatting inconsistencies between save and load

### Pitfall 4: Optimistic Updates with Mutation

**What goes wrong:** Mutating arrays/objects in optimistic updates instead of creating new references causes React rendering bugs and state corruption.

**Why it happens:** JavaScript's mutable array methods (`.push()`, `.splice()`) are more familiar than immutable patterns.

**How to avoid:**
```typescript
// ❌ WRONG - Mutates existing array
const existingTasks = localStore.getQuery(api.tasks.list, { projectId });
existingTasks.push(newTask); // BUG - mutates reference
localStore.setQuery(api.tasks.list, { projectId }, existingTasks);

// ✅ CORRECT - Creates new array
const existingTasks = localStore.getQuery(api.tasks.list, { projectId });
const updatedTasks = [...existingTasks, newTask]; // New reference
localStore.setQuery(api.tasks.list, { projectId }, updatedTasks);
```

**Warning signs:**
- UI doesn't update after optimistic mutation
- State reverts unexpectedly
- React DevTools shows unchanged object references

### Pitfall 5: Permission Checks Only on Frontend

**What goes wrong:** Task deletion, editing restricted in UI but not enforced in Convex mutations, allowing malicious users to bypass frontend checks via direct API calls.

**Why it happens:** Developers trust the UI layer and forget that Convex functions are public API endpoints.

**How to avoid:**
- **Always** validate permissions in mutation handlers
- Check project membership before task operations
- Use pattern from `convex/projects.ts` for membership validation:
```typescript
// Pattern from codebase
const membership = await ctx.db
  .query("projectMembers")
  .withIndex("by_project_user", (q) =>
    q.eq("projectId", projectId).eq("userId", userId)
  )
  .first();

if (!membership) {
  throw new ConvexError("Not a member of this project");
}
```

**Warning signs:**
- No permission checks in mutation handler bodies
- Comments saying "UI prevents this already"
- Security assumptions about authenticated users

### Pitfall 6: Lack of Clarity in Task Properties

**What goes wrong:** Users confused about task scope, unclear titles, missing context leads to task abandonment and poor organization (from user research).

**Why it happens:** Technical implementation focuses on properties (status, assignee) but ignores UX nudges for clarity.

**How to avoid:**
- Require title field (validation error if empty)
- Encourage description usage with placeholder text: "Add details, links, or context..."
- Show validation hints for vague titles: "Be specific: what needs to be done?"
- Display task age prominently (created X days ago) to prompt updates

**Warning signs:**
- Tasks with single-word titles ("bug", "fix this")
- High percentage of tasks with empty descriptions
- Tasks untouched for 30+ days

### Pitfall 7: Taking On Too Many Tasks at Once

**What goes wrong:** Users create many tasks rapidly but don't complete them, leading to overwhelming lists and decreased productivity (from user research).

**Why it happens:** Frictionless task creation (inline add) makes it easy to dump tasks without prioritization.

**How to avoid:**
- Show active task count prominently: "You have 8 tasks in progress"
- Visual nudge when creating 5+ tasks without closing any: "Focus on completing existing tasks first?"
- Default sort by creation date (oldest first) to surface abandoned tasks
- Empty state for completed tasks: "No completed tasks yet — mark some as done!"

**Warning signs:**
- User has 20+ tasks with "In Progress" status
- Completed task count = 0 after 1 week of usage
- Continuous task creation without status changes

---

## Code Examples

### Example 1: Creating a Task with Validation

```typescript
// Source: Verified pattern from CreateProjectDialog.tsx + Context7 Convex docs
// convex/tasks.ts
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()), // BlockNote JSON
    statusId: v.optional(v.id("taskStatuses")),
    assigneeId: v.optional(v.id("users")),
    priority: v.optional(
      v.union(
        v.literal("urgent"),
        v.literal("high"),
        v.literal("medium"),
        v.literal("low")
      )
    ),
  },
  returns: v.id("tasks"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Validate project membership
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new ConvexError("Not a member of this project");
    }

    // Get project to access workspaceId
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new ConvexError("Project not found");

    // Get default status if not provided
    let statusId = args.statusId;
    if (!statusId) {
      const defaultStatus = await ctx.db
        .query("taskStatuses")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", project.workspaceId)
        )
        .filter((q) => q.eq(q.field("isDefault"), true))
        .first();

      if (!defaultStatus) {
        throw new ConvexError("No default status found for workspace");
      }
      statusId = defaultStatus._id;
    }

    // Create task
    const taskId = await ctx.db.insert("tasks", {
      projectId: args.projectId,
      workspaceId: project.workspaceId,
      title: args.title,
      description: args.description,
      statusId,
      assigneeId: args.assigneeId,
      priority: args.priority ?? "medium",
      completed: false,
      creatorId: userId,
    });

    return taskId;
  },
});
```

### Example 2: Task List Query with Filtering

```typescript
// Source: Context7 Convex patterns
// convex/tasks.ts
export const listProjectTasks = query({
  args: {
    projectId: v.id("projects"),
    hideCompleted: v.optional(v.boolean()),
  },
  returns: v.array(v.any()), // TODO: Define proper task with relations type
  handler: async (ctx, { projectId, hideCompleted }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Validate access
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", projectId).eq("userId", userId)
      )
      .first();

    if (!membership) return [];

    // Query with compound index
    const shouldHideCompleted = hideCompleted ?? true;
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project_completed", (q) =>
        q.eq("projectId", projectId).eq("completed", shouldHideCompleted ? false : undefined)
      )
      .order("desc") // Newest first by default
      .collect();

    // Enrich with relations (status, assignee)
    const enrichedTasks = await Promise.all(
      tasks.map(async (task) => {
        const status = await ctx.db.get(task.statusId);
        const assignee = task.assigneeId ? await ctx.db.get(task.assigneeId) : null;

        return {
          ...task,
          status,
          assignee,
        };
      })
    );

    return enrichedTasks;
  },
});
```

### Example 3: Inline Task Creation Component

```typescript
// Source: Codebase form patterns + UX from CONTEXT.md
// src/pages/App/Project/CreateTaskInline.tsx
import { Input } from "@/components/ui/input";
import { useMutation } from "convex/react";
import { useState, useRef, useEffect } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useToast } from "@/components/ui/use-toast";

export function CreateTaskInline({ projectId }: { projectId: Id<"projects"> }) {
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createTask = useMutation(api.tasks.create);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsCreating(true);
    try {
      await createTask({
        projectId,
        title: title.trim(),
        // Other properties use defaults
      });
      setTitle("");
      inputRef.current?.focus(); // Keep focus for rapid entry
    } catch (error) {
      toast({
        title: "Error creating task",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4">
      <Input
        ref={inputRef}
        placeholder="Add a task... (press Enter)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={isCreating}
        className="border-dashed"
      />
    </form>
  );
}
```

### Example 4: Task Row Component with Status Badge

```typescript
// Source: GitHub Issues compact design + CONTEXT.md requirements
// src/pages/App/Project/TaskRow.tsx
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AlertCircle, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface TaskRowProps {
  task: {
    _id: Id<"tasks">;
    title: string;
    status: { name: string; color: string };
    priority: "urgent" | "high" | "medium" | "low";
    assignee?: { name: string };
  };
  onClick: () => void;
}

const priorityIcons = {
  urgent: <AlertCircle className="h-4 w-4 text-red-500" />,
  high: <ArrowUp className="h-4 w-4 text-orange-500" />,
  medium: <Minus className="h-4 w-4 text-yellow-500" />,
  low: <Minus className="h-4 w-4 text-gray-400" />,
};

export function TaskRow({ task, onClick }: TaskRowProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-4 py-2 border-b",
        "hover:bg-accent cursor-pointer transition-colors"
      )}
    >
      {/* Priority icon */}
      <div className="flex-shrink-0">
        {priorityIcons[task.priority]}
      </div>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{task.title}</p>
      </div>

      {/* Status badge */}
      <Badge variant="secondary" className={cn("flex-shrink-0", task.status.color)}>
        {task.status.name}
      </Badge>

      {/* Assignee avatar */}
      {task.assignee && (
        <Avatar className="h-6 w-6 flex-shrink-0">
          <AvatarFallback className="text-xs">
            {task.assignee.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Redux for all state | React Query for server state, Zustand/Jotai for client state | 2024-2025 | Convex already handles server state reactively — minimal additional state management needed |
| react-window for virtualization | Tanstack Virtual (TanStack Table v8) | Nov 2024+ | Better performance, smaller bundle, framework-agnostic |
| Tiptap for rich text | BlockNote (built on Tiptap) | 2023+ | Block-based editing (Notion-style), better for structured content like task descriptions |
| Custom form libraries | React Hook Form v7 + Zod | 2023+ | Type-safe validation, better DX with Zod inference |
| Enum-based statuses | Database entities | 2024+ | User customization requirement drives architecture |

**Deprecated/outdated:**
- **react-beautiful-dnd**: Deprecated in favor of @dnd-kit (better accessibility, touch support)
- **react-window**: Superseded by Tanstack Virtual for better API and performance
- **Custom contentEditable**: Accessibility nightmare — use BlockNote or Tiptap
- **Redux for server state**: Convex provides reactive queries — no need for Redux

---

## Open Questions

### 1. **Label Implementation Strategy**

**What we know:**
- User wants labels visible in detail panel only (not in list rows per CONTEXT.md)
- Common patterns: predefined workspace labels vs freeform per-task tags
- Existing codebase has `tags: v.optional(v.array(v.string()))` on documents table

**What's unclear:**
- Should labels be workspace-scoped entities (like statuses) or freeform strings?
- If workspace-scoped, do we need label management UI in Phase 2 or defer to Phase 3?
- Color-coded labels vs plain text tags?

**Recommendation:**
- **Phase 2**: Use freeform string array (`taskLabels: v.optional(v.array(v.string()))`) for simplicity
- **Phase 3+**: Migrate to workspace-scoped label entities with colors when building label management UI
- Pattern matches existing `tags` field on documents table for consistency

### 2. **Virtual Scrolling Threshold**

**What we know:**
- Virtual scrolling improves performance for large lists
- Adds complexity to implementation
- Common threshold: 100-200+ items before virtual scrolling needed

**What's unclear:**
- Expected task list size for MVP users
- Performance impact on low-end devices without virtual scrolling
- Whether to implement upfront or add later when needed

**Recommendation:**
- **Phase 2**: Skip virtual scrolling initially — build with assumption of <200 tasks per project
- **Monitor**: Add instrumentation to track task list sizes in production
- **Phase 3+**: Add Tanstack Virtual if median project has >100 tasks or performance complaints
- Rationale: Premature optimization — validate task list usage patterns first

### 3. **Creation Modal vs Inline-Only**

**What we know:**
- Inline add captures title only (fast, frictionless)
- Side panel has full editing (title, description, properties)
- User reconsidered creation modal since side panel exists (per CONTEXT.md)

**What's unclear:**
- Do users want to set status/assignee/priority at creation time, or is title-first + edit-later acceptable?
- Modal adds friction but enables upfront context setting
- Linear uses modal for creation, GitHub uses inline — which UX wins?

**Recommendation:**
- **Phase 2**: Inline add only (title → Enter → task created with defaults)
- **Immediate edit path**: After Enter, optionally auto-open side panel for newly created task
- **User config option**: "Open detail panel after creating task" (default: off)
- Rationale: Validate if users actually set properties upfront before adding modal complexity

---

## Sources

### Primary (HIGH confidence)

**Context7 Documentation:**
- /llmstxt/convex_dev_llms-full_txt - Database schema design, compound indexes, optimistic updates, query patterns
- /websites/blocknotejs - BlockNote editor setup, React integration, content handling

**Official Documentation (via WebFetch):**
- Convex Database Indexes: https://docs.convex.dev/database/indexes/indexes-and-query-perf
- Convex Optimistic Updates: https://docs.convex.dev/client/react/optimistic-updates
- BlockNote Getting Started: https://www.blocknotejs.org/docs/getting-started

**Codebase Evidence:**
- /home/lambda/projects/ripple/convex/schema.ts - Existing schema patterns
- /home/lambda/projects/ripple/convex/projects.ts - Permission validation patterns
- /home/lambda/projects/ripple/src/pages/App/Project/CreateProjectDialog.tsx - Form patterns with react-hook-form + Zod
- /home/lambda/projects/ripple/package.json - Confirmed dependency versions

### Secondary (MEDIUM confidence)

**WebSearch - UI/UX Patterns:**
- [Linear Issue Status Documentation](https://linear.app/docs/configuring-workflows) - Customizable status columns with default set (Backlog → Todo → In Progress → Done → Canceled)
- [Jira Status Management](https://titanapps.io/blog/jira-status/) - Status entity architecture with color, order, and workflow sequences
- [Asana Custom Statuses](https://www.avaza.com/introducing-custom-task-types-and-statuses/) - Three-stage task model (not started, started, closed) with custom statuses per stage

**WebSearch - React State Management:**
- [Syncfusion React State Management 2026](https://www.syncfusion.com/blogs/post/react-state-management-libraries) - Hybrid approach: React Query for server data, useState/Context for local state
- [React State Management Patterns 2026](https://www.nucamp.co/blog/state-management-in-2026-redux-context-api-and-modern-patterns) - Zustand for lightweight state, Jotai for atomic state
- [Developer Way React State 2025](https://www.developerway.com/posts/react-state-management-2025) - Specialized tools matched to data types and update frequencies

**WebSearch - Performance Optimization:**
- [Tanstack Virtual List Performance](https://medium.com/@ignatovich.dm/virtualization-in-react-improving-performance-for-large-lists-3df0800022ef) - Virtual scrolling reduces DOM elements and memory usage
- [React List Virtualization Patterns](https://namastedev.com/blog/maximizing-performance-strategies-for-list-rendering-and-virtual-scrolling-in-react/) - Tanstack Virtual as modern standard (Nov 2024+)

### Tertiary (LOW confidence)

**WebSearch - Task Management Pitfalls:**
- [LinkedIn Task Management Pitfalls](https://www.linkedin.com/advice/1/what-some-common-task-management-pitfalls-mistakes) - Lack of clarity, poor organization, task overload
- [Workast Task Management Mistakes](https://www.workast.com/blog/common-task-management-mistakes-and-how-to-avoid-them/) - Communication gaps, unclear priorities
- [Peaktime Task Management](https://peaktime.app/en/common-task-management-mistakes/) - User-level mistakes (memory reliance, multitasking)

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** - All dependencies verified in package.json, Context7 docs confirm API patterns
- Architecture: **HIGH** - Patterns verified in existing codebase (projects.ts, CreateProjectDialog.tsx), Context7 confirms Convex best practices
- Pitfalls: **MEDIUM** - Technical pitfalls (indexes, optimistic updates) verified in Convex docs; UX pitfalls from generalized task management research, not product-specific

**Research date:** 2026-02-06
**Valid until:** ~2026-03-08 (30 days for stable stack — Convex, React Hook Form, BlockNote have stable APIs)

**Assumptions to validate:**
- Task list sizes stay under 200 items per project (affects virtual scrolling decision)
- Users primarily create tasks via inline add, not modal (affects UI investment)
- Labels are low-priority metadata (deferred customization acceptable)
- Cross-project task views (My Tasks) don't require advanced filtering in Phase 2
