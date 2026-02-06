# Phase 4: Chat-to-Task Integration - Research

**Researched:** 2026-02-06
**Domain:** Chat-to-task bridge with context capture, inline task mentions, and autocomplete
**Confidence:** HIGH

## Summary

Phase 4 builds the bridge between the existing chat system (messages) and task management system (Phase 2). The implementation involves four main components: (1) right-click context menu integration for task creation from messages, (2) a quick popover UI for minimal-friction task creation, (3) inline task chip rendering in chat messages with live status updates, and (4) autocomplete for task mentions using # trigger character. The codebase already has established patterns for all required pieces: context menus (Message.tsx), popovers (shadcn/ui), BlockNote inline content (UserBlock.tsx), and SuggestionMenuController (DocumentEditor.tsx). The phase focuses on composition rather than new primitives.

**Primary recommendation:** Extend existing patterns for context menus and inline content rather than creating new systems. Use BlockNote's inline content specs for task chips in messages, leverage SuggestionMenuController for # autocomplete, and follow the message-to-HTML-to-BlockNote conversion pattern already used in MessageComposer.tsx.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Task creation flow:**
- Trigger: right-click context menu on a message ("Create task from message" option)
- UX: quick popover near the message with title pre-filled, project picker, and Create button — minimal friction
- Title pre-fill: first line of message text, truncated to ~80 chars if long
- Project selection: auto-select the channel's linked project if one exists, otherwise show a project picker dropdown

**Context capture:**
- Scope: just the single right-clicked message — no surrounding thread context
- Storage: message content goes into the task's BlockNote description field (rich text preserved)
- No backlink: no sourceMessageId field — the description content is sufficient
- Chat feedback: a system message appears in chat after task creation ("Alice created a task from this message") with a link/reference to the created task

**Inline task previews:**
- Appearance: compact inline chip/badge that flows with the message text
- Content: colored status dot + truncated task title only (no assignee avatar)
- Click behavior: navigates to the project task view with the task selected/highlighted
- Live updates: status dot updates in real-time via Convex reactivity as task status changes

**Task mention syntax:**
- Trigger character: # opens an autocomplete dropdown
- Scope: shows tasks from the current channel's linked project; if no linked project, show all user's tasks
- Search: fuzzy search by task title as user types after #
- Result: selected task is inserted as an inline chip in the message

### Claude's Discretion

- Autocomplete dropdown styling and positioning
- System message format and wording
- How message content is converted to BlockNote format
- Popover positioning and responsive behavior
- Handling of edge cases (deleted tasks in mentions, permissions)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

## Standard Stack

The phase uses existing libraries already in the codebase (from package.json):

### Core (Already Installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @blocknote/core | 0.46.2 | Rich text editor engine | Already used for MessageComposer and DocumentEditor; provides inline content specs for task chips |
| @blocknote/react | 0.46.2 | React integration for BlockNote | Provides SuggestionMenuController for # autocomplete |
| @radix-ui/react-context-menu | 2.2.16 | Context menu primitive | Already used in Message.tsx for edit/delete |
| @radix-ui/react-popover | 1.1.15 | Popover primitive | shadcn/ui wrapper exists, handles positioning automatically |
| react-router-dom | 7.13.0 | Navigation | useNavigate hook for task chip click navigation |

### Supporting (Already Installed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| convex | 1.31.7 | Backend queries/mutations | Real-time task status updates, message storage |
| uuid4 | 2.0.3 | Client-generated IDs | isomorphicId for messages (existing pattern) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| BlockNote inline content | Custom HTML parsing | Inline content specs integrate natively with editor, preserve structure |
| SuggestionMenuController | Custom dropdown component | BlockNote's controller handles positioning, keyboard nav, filtering automatically |
| Simple .includes() fuzzy search | Fuse.js or microfuzz library | For small result sets (tasks in a project), simple filtering is sufficient; no external dependency needed |

**Installation:** No new packages required — all dependencies already installed.

## Architecture Patterns

### Recommended File Structure

```
src/pages/App/Chat/
├── Message.tsx                    # ADD: "Create task" context menu item
├── MessageComposer.tsx            # ADD: # autocomplete for task mentions
├── TaskMentionChip.tsx           # NEW: Inline task chip component (read-only, for viewing)
└── CreateTaskFromMessagePopover.tsx  # NEW: Quick task creation UI

src/pages/App/Chat/CustomInlineContent/
└── TaskMention.tsx                # NEW: BlockNote inline content spec for #task references

convex/
├── messages.ts                    # ADD: mutation for sending messages with task mentions
└── tasks.ts                       # ADD: query for autocomplete (search tasks by title)
```

### Pattern 1: Context Menu Extension

**What:** Add "Create task from message" option to existing Message.tsx context menu
**When to use:** Right-click on any message in chat
**Example:**
```tsx
// Source: Existing Message.tsx pattern
<ContextMenu>
  <ContextMenuTrigger>
    <SafeHtml html={body} className="..." />
  </ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem onClick={handleEdit}>Edit</ContextMenuItem>
    <ContextMenuItem onClick={handleDelete}>Delete</ContextMenuItem>
    {/* NEW */}
    <ContextMenuItem onClick={handleCreateTask}>
      Create task from message
    </ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

### Pattern 2: Popover for Quick Task Creation

**What:** Minimal-friction popover near the message with pre-filled title, project picker, and Create button
**When to use:** After user clicks "Create task from message"
**Example:**
```tsx
// Source: shadcn/ui Popover patterns + convex/tasks.ts create mutation
<Popover open={isCreatingTask} onOpenChange={setIsCreatingTask}>
  <PopoverAnchor asChild>
    <div ref={messageRef} /> {/* Invisible anchor positioned near message */}
  </PopoverAnchor>
  <PopoverContent side="bottom" align="start" className="w-96">
    <div className="space-y-4">
      <Input
        value={taskTitle}
        onChange={(e) => setTaskTitle(e.target.value)}
        placeholder="Task title"
      />
      <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
        {/* Project options */}
      </Select>
      <Button onClick={handleCreateTask}>Create Task</Button>
    </div>
  </PopoverContent>
</Popover>
```

**Key insight:** Use PopoverAnchor to position near the message without making the message itself the trigger. This allows context menu click to open popover.

### Pattern 3: BlockNote Inline Content for Task Chips

**What:** Define custom inline content spec (similar to existing UserBlock.tsx mention pattern)
**When to use:** Rendering task references inline in messages
**Example:**
```tsx
// Source: Based on src/pages/App/Document/CustomBlocks/UserBlock.tsx pattern
import { createReactInlineContentSpec } from "@blocknote/react";

const TaskMentionView = ({ taskId }: { taskId: Id<"tasks"> }) => {
  const task = useQuery(api.tasks.get, { taskId });

  if (!task) return <span className="text-muted-foreground">#deleted-task</span>;

  const statusColor = task.status?.color || "bg-gray-500";

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted hover:bg-muted/80 cursor-pointer transition-colors">
      {/* Status dot */}
      <span className={cn("h-2 w-2 rounded-full", statusColor)} />
      {/* Task title (truncated) */}
      <span className="font-medium text-sm max-w-[200px] truncate">
        {task.title}
      </span>
    </span>
  );
};

export const TaskMention = createReactInlineContentSpec(
  {
    type: "taskMention",
    propSchema: {
      taskId: { default: null as unknown as Id<"tasks"> },
    },
    content: "none",
  },
  {
    render: ({ inlineContent }) => {
      const { taskId } = inlineContent.props;
      if (!taskId) return <span>#unknown</span>;
      return <TaskMentionView taskId={taskId} />;
    },
  }
);
```

**Live updates:** Convex reactivity automatically re-renders TaskMentionView when task.status changes, updating the status dot color in real-time.

### Pattern 4: SuggestionMenuController for # Autocomplete

**What:** Use BlockNote's built-in SuggestionMenuController (already used in DocumentEditor.tsx for @ mentions)
**When to use:** Typing # in MessageComposer triggers task autocomplete
**Example:**
```tsx
// Source: Existing DocumentEditor.tsx @ mention pattern
<BlockNoteView editor={editor}>
  <SuggestionMenuController
    triggerCharacter={"#"}
    getItems={async (query) => {
      // Get channel to check for linked project
      const channel = await channelQuery;
      const projectId = channel?.linkedProjectId;

      // Query tasks: project tasks if linked, otherwise all user's tasks
      const tasks = projectId
        ? await ctx.runQuery(api.tasks.listByProject, { projectId })
        : await ctx.runQuery(api.tasks.listByAssignee, { workspaceId });

      // Simple fuzzy filter: case-insensitive includes
      return tasks
        .filter(task =>
          task.title.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 10) // Limit results
        .map(task => ({
          title: task.title,
          onItemClick: () => {
            editor.insertInlineContent([
              {
                type: "taskMention",
                props: { taskId: task._id },
              },
              " ", // Space after mention
            ]);
          },
          // Show status color in dropdown
          icon: <div className={cn("h-3 w-3 rounded-full", task.status.color)} />,
          group: projectId ? "Project tasks" : "My tasks",
          key: task._id,
        }));
    }}
  />
</BlockNoteView>
```

**Fuzzy search:** Simple `.includes()` filter is sufficient for small result sets (tasks in a single project). No need for heavy libraries like Fuse.js.

### Pattern 5: HTML-to-BlockNote Conversion for Task Descriptions

**What:** Convert message HTML to BlockNote JSON for task description field
**When to use:** Creating task from message — preserve rich text formatting
**Example:**
```tsx
// Source: MessageComposer.tsx already uses editor.tryParseHTMLToBlocks()
const handleCreateTaskFromMessage = async (message: MessageWithAuthor) => {
  // Parse message HTML to BlockNote blocks
  const descriptionBlocks = editor.tryParseHTMLToBlocks(message.body);

  // Serialize to JSON string for storage
  const description = JSON.stringify(descriptionBlocks);

  await createTask({
    projectId: selectedProjectId,
    title: extractTitle(message.plainText), // First line, truncated
    description, // BlockNote JSON as string
    // ... other fields
  });
};

// Helper: Extract first line up to 80 chars
const extractTitle = (plainText: string): string => {
  const firstLine = plainText.split('\n')[0];
  return firstLine.length > 80
    ? firstLine.substring(0, 77) + '...'
    : firstLine;
};
```

**Important:** Tasks table stores description as `v.optional(v.string())` — store BlockNote JSON as serialized string, not raw HTML.

### Pattern 6: Navigation with State for Task Highlighting

**What:** Navigate to project view with task selected/highlighted when clicking task chip
**When to use:** User clicks a task mention chip in chat
**Example:**
```tsx
// Source: React Router v7 useNavigate with state
import { useNavigate } from "react-router-dom";

const handleTaskChipClick = (taskId: Id<"tasks">, projectId: Id<"projects">) => {
  navigate(`/workspaces/${workspaceId}/projects/${projectId}`, {
    state: { highlightTaskId: taskId }
  });
};

// In ProjectDetails.tsx (kanban view)
const location = useLocation();
const highlightTaskId = location.state?.highlightTaskId;

// Apply highlight styling
<KanbanCard
  task={task}
  className={cn(
    task._id === highlightTaskId && "ring-2 ring-primary ring-offset-2"
  )}
/>
```

### Pattern 7: System Messages for Task Creation Feedback

**What:** Insert a special message type indicating task was created from chat
**When to use:** After successfully creating task from message
**Example:**
```tsx
// Option 1: Use existing message body with special formatting
await sendMessage({
  channelId,
  body: `<div class="system-message">
    <span class="text-muted-foreground">
      ${userName} created a task from this message:
      <a href="#" data-task-id="${taskId}">View task</a>
    </span>
  </div>`,
  plainText: `${userName} created a task from this message`,
  isomorphicId: generateIsomorphicId(),
});

// Option 2: Add isSystemMessage field to schema (requires migration)
// Defer to Claude's discretion based on time constraints
```

**Recommendation:** Use Option 1 (special HTML formatting) to avoid schema changes. System messages can be styled differently via CSS class.

### Anti-Patterns to Avoid

- **Don't create task chips as raw HTML strings:** Use BlockNote inline content specs for proper structure and reactivity
- **Don't store HTML in task description field:** Store BlockNote JSON (serialized) to preserve structure for editing in TaskDetailSheet
- **Don't build custom autocomplete dropdown:** SuggestionMenuController handles positioning, keyboard navigation, and filtering automatically
- **Don't add sourceMessageId foreign key to tasks table:** Per CONTEXT.md decision, description content is sufficient for v1

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Autocomplete dropdown | Custom positioned dropdown with keyboard nav | BlockNote's SuggestionMenuController | Handles positioning, keyboard navigation (arrow keys, enter), and filtering out of the box |
| Fuzzy string matching | Levenshtein distance algorithm | Simple `.includes()` for small sets | Tasks per project are typically <100; includes() is fast enough and simpler |
| Inline chips in rich text | Custom HTML with React hydration | BlockNote inline content specs (createReactInlineContentSpec) | Native integration with editor, proper structure, automatic reactivity |
| Popover positioning | Manual getBoundingClientRect() calculations | Radix UI Popover with PopoverAnchor | Handles viewport collisions, scroll containers, and responsive layouts automatically |

**Key insight:** BlockNote is already integrated for MessageComposer and has all the primitives needed (inline content, suggestions, HTML parsing). Don't reinvent these wheels.

## Common Pitfalls

### Pitfall 1: BlockNote Schema Mismatch Between Composer and Display

**What goes wrong:** Task mentions render in MessageComposer (editing) but break when viewing messages (SafeHtml component doesn't know about custom inline content)
**Why it happens:** MessageComposer uses BlockNote editor with custom schema, but Message.tsx displays pre-rendered HTML via SafeHtml. Task chips are inline content specs that don't exist in the display HTML.
**How to avoid:**
  1. When sending message with task mention, BlockNote serializes to HTML using `blocksToFullHTML()`
  2. Task mention inline content must render to semantic HTML (e.g., `<span data-task-id="...">`)
  3. In Message.tsx, enhance SafeHtml to detect `data-task-id` attributes and render TaskMentionChip components
**Warning signs:** Task mentions visible in composer but show as plain text or broken HTML in sent messages

### Pitfall 2: Stale Task Data in Inline Chips

**What goes wrong:** Task chip shows old status/title after task is updated elsewhere
**Why it happens:** Task data cached in component without Convex reactivity subscription
**How to avoid:** TaskMentionView component must use `useQuery(api.tasks.get, { taskId })` to get live updates, not props passed down from parent
**Warning signs:** User updates task in kanban view, but chip in chat still shows old status color

### Pitfall 3: Popover Positioning Outside Viewport

**What goes wrong:** Task creation popover appears off-screen or cut off by scroll container
**Why it happens:** Default PopoverContent positioning doesn't account for chat scroll container
**How to avoid:**
  1. Use PopoverAnchor to position near message (not the context menu click point)
  2. Set PopoverContent props: `side="bottom" align="start"` to prefer visible area
  3. Radix UI handles viewport collision automatically with fallback positioning
**Warning signs:** Popover only visible when message is at top of viewport

### Pitfall 4: Context Menu Stays Open After Creating Task

**What goes wrong:** Context menu remains visible after clicking "Create task", overlapping with popover
**Why it happens:** ContextMenu open state not controlled
**How to avoid:**
  1. Make ContextMenu controlled: `<ContextMenu open={isContextMenuOpen} onOpenChange={setIsContextMenuOpen}>`
  2. In handleCreateTask: `setIsContextMenuOpen(false)` before opening popover
**Warning signs:** User sees both context menu and popover simultaneously

### Pitfall 5: Autocomplete Shows Deleted/Archived Tasks

**What goes wrong:** # autocomplete suggests tasks that no longer exist or are completed
**Why it happens:** Query doesn't filter by task state
**How to avoid:**
  1. Use existing `listByProject` query with `hideCompleted: true` parameter (already exists in tasks.ts)
  2. Filter out tasks where task.completed === true (or create dedicated autocomplete query)
**Warning signs:** User selects task from autocomplete but chip shows "deleted-task" or completed tasks clutter the list

### Pitfall 6: XSS Vulnerability in System Messages

**What goes wrong:** Malicious user injects script tags via task title that renders in system message
**Why it happens:** Task title concatenated into HTML string without sanitization
**How to avoid:**
  1. Use existing SafeHtml component (already uses DOMPurify) for system messages
  2. Never concatenate user input directly into HTML strings
  3. For task title in system message, render as text content: `<span>{task.title}</span>`
**Warning signs:** Task titles with `<script>` or `<img onerror=>` tags execute in chat

### Pitfall 7: Race Condition in Task Creation + Message Send

**What goes wrong:** System message sent before task is created, resulting in broken link or missing task ID
**Why it happens:** Asynchronous mutation calls not awaited properly
**How to avoid:**
```tsx
// WRONG: Race condition
const taskId = createTask({ ... }); // Returns promise
await sendMessage({ body: `Task ${taskId} created` }); // taskId may be undefined

// CORRECT: Await task creation
const taskId = await createTask({ ... });
await sendMessage({ body: `Task ${taskId} created` });
```
**Warning signs:** Intermittent failures where system message appears but task ID is undefined or message sends first

## Code Examples

Verified patterns from codebase and official sources:

### Converting Message to Task Description (HTML → BlockNote JSON)

```tsx
// Source: MessageComposer.tsx lines 64 and 82
const messageHtml = message.body; // Already stored as HTML

// Create temporary BlockNote editor instance for parsing
const tempEditor = BlockNoteEditor.create({ schema });
const blocks = tempEditor.tryParseHTMLToBlocks(messageHtml);

// Serialize to JSON string for storage
const description = JSON.stringify(blocks);

await createTask({
  projectId,
  title: extractFirstLine(message.plainText),
  description, // BlockNote JSON as string
});
```

### Rendering Task Chip with Live Updates

```tsx
// Source: Based on UserBlock.tsx pattern
const TaskChipView = ({ taskId }: { taskId: Id<"tasks"> }) => {
  const task = useQuery(api.tasks.get, { taskId });
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  if (!task) {
    return <span className="text-muted-foreground text-sm">#deleted</span>;
  }

  const handleClick = () => {
    navigate(`/workspaces/${workspaceId}/projects/${task.projectId}`, {
      state: { highlightTaskId: taskId }
    });
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted hover:bg-muted/80 transition-colors cursor-pointer"
    >
      {/* Status dot - updates live when task.status changes */}
      <span
        className={cn("h-2 w-2 rounded-full", task.status?.color || "bg-gray-500")}
      />
      {/* Truncated title */}
      <span className="font-medium text-sm max-w-[200px] truncate">
        {task.title}
      </span>
    </button>
  );
};
```

### Task Autocomplete with # Trigger

```tsx
// Source: DocumentEditor.tsx SuggestionMenuController pattern (lines 96-159)
<SuggestionMenuController
  triggerCharacter={"#"}
  getItems={async (query) => {
    // Get channel to determine project scope
    const channel = useQuery(api.channels.get, { id: channelId });
    const projectId = channel?.linkedProjectId;

    // Query tasks from appropriate scope
    const tasks = projectId
      ? await api.tasks.listByProject({ projectId, hideCompleted: true })
      : await api.tasks.listByAssignee({ workspaceId, hideCompleted: true });

    // Filter by query (case-insensitive)
    return tasks
      .filter(task => task.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 10) // Limit to 10 results
      .map(task => ({
        title: task.title,
        subtext: task.status?.name, // Show status name as subtext
        onItemClick: () => {
          editor.insertInlineContent([
            { type: "taskMention", props: { taskId: task._id } },
            " ", // Space after insertion
          ]);
        },
        icon: (
          <div className={cn("h-3 w-3 rounded-full", task.status?.color)} />
        ),
        group: projectId ? "Project tasks" : "My tasks",
        key: task._id,
      }));
  }}
/>
```

### Handling SafeHtml with Custom Inline Content

```tsx
// Source: Custom implementation pattern
// Problem: SafeHtml renders pre-serialized HTML, doesn't know about BlockNote inline content
// Solution: Post-process HTML to inject React components for task chips

const MessageContent = ({ html }: { html: string }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    // Find all task mention spans (rendered by BlockNote as data attributes)
    const taskSpans = ref.current.querySelectorAll('[data-task-id]');

    taskSpans.forEach(span => {
      const taskId = span.getAttribute('data-task-id') as Id<"tasks">;

      // Replace with React component (using ReactDOM.render or portal)
      const root = createRoot(span);
      root.render(<TaskChipView taskId={taskId} />);
    });
  }, [html]);

  return <SafeHtml html={html} ref={ref} />;
};

// Alternative: Modify TaskMention inline content spec to render semantic HTML
export const TaskMention = createReactInlineContentSpec(
  { /* ... */ },
  {
    render: ({ inlineContent }) => (
      <span data-task-id={inlineContent.props.taskId}>
        <TaskChipView taskId={inlineContent.props.taskId} />
      </span>
    ),
  }
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| TipTap mentions as decorations | BlockNote inline content specs | BlockNote 0.46+ | Inline content has proper schema, validation, and serialization — cleaner than decorations |
| Custom positioned dropdowns | Radix UI Popover with auto-positioning | Radix UI v1.0+ | Handles viewport collisions, scroll containers, and responsive layouts automatically |
| Manual keyboard nav in autocomplete | SuggestionMenuController built-in | BlockNote core feature | Arrow keys, Enter, Escape handled out of the box |

**Deprecated/outdated:**
- Manual HTML sanitization: DOMPurify (via SafeHtml component) is now standard
- Custom fuzzy search for small datasets: Simple `.includes()` is sufficient and faster than library overhead for <100 items

## Open Questions

Things that couldn't be fully resolved:

1. **System message storage strategy**
   - What we know: Messages table has body (HTML) and plainText fields; no isSystemMessage flag
   - What's unclear: Best way to distinguish system messages (CSS class in HTML vs. new schema field)
   - Recommendation: Use CSS class approach (`<div class="system-message">...</div>`) to avoid schema migration in Phase 4; defer dedicated field to future phase if needed

2. **Task chip interactivity in BlockNote vs SafeHtml**
   - What we know: BlockNote editor (MessageComposer) renders inline content specs natively; SafeHtml (Message.tsx display) renders static HTML
   - What's unclear: Best pattern to hydrate task chips in SafeHtml (post-process DOM vs. custom parser)
   - Recommendation: Post-process DOM with useEffect to find `[data-task-id]` spans and inject React components; simpler than building custom HTML parser

3. **Channel-to-project linking in existing schema**
   - What we know: Projects table has linkedChannelId; need reverse lookup (channel → project)
   - What's unclear: Is there an index for channels.linkedChannelId lookup, or do we scan all projects?
   - Recommendation: Add query `projects.getByLinkedChannel({ channelId })` using `.filter()` on projects.by_workspace index; small dataset (few projects per workspace) so filter is acceptable

## Sources

### Primary (HIGH confidence)

- `/websites/blocknotejs` - BlockNote inline content specs, SuggestionMenuController, HTML parsing (tryParseHTMLToBlocks)
- `/websites/ui_shadcn` - Popover positioning, alignment, responsive behavior
- Codebase files:
  - `src/pages/App/Document/DocumentEditor.tsx` - Existing SuggestionMenuController pattern for @ mentions
  - `src/pages/App/Document/CustomBlocks/UserBlock.tsx` - Inline content spec pattern
  - `src/pages/App/Chat/Message.tsx` - Context menu pattern
  - `src/pages/App/Chat/MessageComposer.tsx` - BlockNote in chat, HTML parsing
  - `convex/schema.ts` - Tasks, messages, projects schema
  - `convex/tasks.ts` - Existing queries (listByProject, listByAssignee)
  - `convex/projects.ts` - Projects with linkedChannelId

### Secondary (MEDIUM confidence)

- [TipTap Suggestion utility](https://tiptap.dev/docs/editor/api/utilities/suggestion) - Trigger character concepts
- [TipTap Mention extension](https://tiptap.dev/docs/editor/extensions/nodes/mention) - Mention patterns (BlockNote uses TipTap under the hood)
- [React Router v7 useNavigate](https://reactrouter.com/api/hooks/useNavigate) - Navigation with state
- [React Autocomplete patterns](https://mui.com/material-ui/react-autocomplete/) - General autocomplete UX patterns

### Tertiary (LOW confidence)

- [Fuse.js fuzzy search](https://www.fusejs.io/) - Considered but not needed (simple includes() sufficient)
- [Adobe RTE badges](https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/developing/extensibility/ui/content-fragments/examples/editor-rte-badges) - Inline chip concepts (not directly applicable)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed and in use
- Architecture: HIGH - Existing patterns well-established (UserBlock, SuggestionMenuController)
- Pitfalls: HIGH - Common issues identified from similar features in codebase
- Open questions: MEDIUM - Some implementation details require runtime testing

**Research date:** 2026-02-06
**Valid until:** 30 days (BlockNote and Radix UI are stable; no rapid breaking changes expected)
