# Phase 5: Document & Diagram Embeds - Research

**Researched:** 2026-02-06
**Domain:** BlockNote custom blocks/inline content, Excalidraw embeds, multi-autocomplete patterns
**Confidence:** HIGH

## Summary

This phase adds document/diagram embeds, user @mentions, and project references to task descriptions and chat messages. The core challenge is implementing multiple custom inline content types in BlockNote with a unified `#` autocomplete that differentiates between documents, diagrams, and projects.

The good news: Ripple already has proven patterns for all required pieces. Task mentions in chat (Phase 4) established the inline content pattern. Document editor already uses diagram blocks and user mentions with `#` and `@` triggers. The implementation reuses existing components (`DiagramBlock`, user mention patterns) and extends them to task descriptions.

**Primary recommendation:** Reuse existing custom inline content patterns from MessageComposer and DocumentEditor. Create new inline content types (documentLink, projectReference) and adapt DiagramBlock as inline content for task descriptions (not as a block, since task descriptions use simple BlockNote without custom blocks).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Diagrams:** Reuse existing `DiagramBlock.tsx` component — same look as in documents
- **Diagrams are read-only** in task descriptions; click opens full Excalidraw editor on the diagram page
- **Documents:** Simple styled link with document icon and title — click navigates to document
- **Deleted references:** Show greyed-out "deleted" label (consistent with document editor behavior)
- **`#` character triggers autocomplete** (same pattern as existing document editors)
- **Combined picker** shows documents, diagrams, AND projects differentiated by icon
- **Picker scope:** All docs/diagrams/projects the user has access to in the workspace (docs and diagrams are workspace-level, not project-scoped)
- **No paste-to-embed** — pasted URLs stay as plain links, only `#` insertion creates embeds/links
- **@mention triggers** autocomplete scoped to project members (people who can see the task)
- **@mention display:** Bold clickable text (no background chip) — clean and unobtrusive
- **@mention click action:** None (display only, no navigation or popover)
- **Removed members:** @mention greys out to indicate they're no longer a project member
- **Project references display:** Inline colored chip with project color dot and name
- **Project references click** navigates to the project page
- **Project references available** in both task descriptions (BlockNote) and chat messages (MessageComposer)
- **Project references inserted** via the same `#` autocomplete picker (combined with docs/diagrams)
- **Inaccessible projects:** Grey chip, no link — consistent with @mention removed-member pattern

### Claude's Discretion
- BlockNote custom block/inline content implementation details
- Autocomplete dropdown styling and keyboard navigation
- How to adapt DiagramBlock for read-only mode in task context
- Search/filter behavior within the `#` picker

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @blocknote/core | 0.46.2 | Block editor engine | Already in use, handles custom inline content |
| @blocknote/react | 0.46.2 | React components | Already in use, provides `createReactInlineContentSpec` |
| @blocknote/shadcn | 0.46.2 | Shadcn UI theme | Already in use, provides `SuggestionMenuController` |
| @excalidraw/excalidraw | 0.18.0 | Diagram rendering | Already in use, provides `exportToSvg` for read-only preview |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | latest | Icons for autocomplete | Document/diagram/project icons in picker |
| React Router | v6 | Navigation | Click handlers for document/project links |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline content for diagrams | Custom block | Blocks can't be used in task descriptions (simple schema), inline content is lighter |
| Combined `#` picker | Separate triggers (`#doc`, `#dia`, `#proj`) | Combined picker is more discoverable, less cognitive load |

**Installation:**
```bash
# All dependencies already installed
```

## Architecture Patterns

### Current Schema Structure
```
TaskDetailSheet uses:
- useCreateBlockNote({}) - default schema only
- No custom blocks or inline content

MessageComposer uses:
- BlockNoteSchema.create with custom inline content (taskMention)
- SuggestionMenuController with # trigger

DocumentEditor uses:
- BlockNoteSchema.create with custom blocks (diagram) and inline content (mention)
- Multiple SuggestionMenuController (# for diagrams, @ for users)
```

### Pattern 1: Custom Inline Content via createReactInlineContentSpec
**What:** Define inline elements that flow within text
**When to use:** For mentions, links, tags that appear alongside text
**Example:**
```typescript
// Source: Existing TaskMention.tsx
export const TaskMention = createReactInlineContentSpec(
  {
    type: "taskMention",
    propSchema: {
      taskId: { default: "" as unknown as string },
      taskTitle: { default: "" },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { taskId, taskTitle } = inlineContent.props;
      return <span data-task-id={taskId}>{taskTitle}</span>;
    },
  }
);
```

### Pattern 2: Multiple SuggestionMenuController Components
**What:** Multiple autocomplete triggers in one editor
**When to use:** When different triggers should show different items
**Example:**
```typescript
// Source: Existing DocumentEditor.tsx
<BlockNoteView editor={editor}>
  <SuggestionMenuController
    triggerCharacter={"#"}
    getItems={async (query) => {
      // Return diagrams
    }}
  />
  <SuggestionMenuController
    triggerCharacter={"@"}
    getItems={async (query) => {
      // Return workspace members
    }}
  />
</BlockNoteView>
```

### Pattern 3: Schema Extension
**What:** Add custom inline content to default schema
**When to use:** When extending BlockNote with custom types
**Example:**
```typescript
// Source: Existing MessageComposer.tsx
const schema = BlockNoteSchema.create({
  blockSpecs: { ...remainingBlockSpecs },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    taskMention: TaskMention,
  },
});
```

### Pattern 4: Diagram Embed as Inline Content (NEW)
**What:** Adapt existing DiagramBlock to work as inline content in simple schemas
**When to use:** Task descriptions use simple schema, can't have custom blocks
**Approach:**
```typescript
// DiagramBlock is currently a custom block
// For task descriptions, create DiagramEmbed inline content that:
// 1. Stores diagramId as prop
// 2. Renders DiagramView (existing component) in inline container
// 3. Wraps in <div> with click handler to navigate to diagram page
// 4. No resize handles (read-only)
```

### Pattern 5: Permission-Scoped Autocomplete
**What:** Filter autocomplete items by user permissions
**When to use:** Always - prevent suggesting inaccessible items
**Example:**
```typescript
// Documents: user has documentMembers record
// Diagrams: user has workspaceMembers record (workspace-level access)
// Projects: user has projectMembers record
// Users (@mentions): user has projectMembers record for same project
```

### Pattern 6: Deleted/Inaccessible Entity Degradation
**What:** Show placeholder when referenced entity is deleted or inaccessible
**When to use:** Inline content renders but entity query returns null
**Example:**
```typescript
// Source: Existing TaskMentionChip.tsx
if (!task) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full
                     bg-background/60 text-muted-foreground text-sm">
      #deleted-task
    </span>
  );
}
```

### Anti-Patterns to Avoid
- **Don't use custom blocks in task descriptions:** TaskDetailSheet uses default schema, adding custom blocks requires schema migration
- **Don't query all workspace members for @mentions:** Scope to project members only (security and UX)
- **Don't allow editing diagrams inline:** Click should navigate to diagram page, not edit in-place
- **Don't use separate triggers for docs/diagrams/projects:** Combined `#` picker is more discoverable

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Autocomplete dropdown | Custom dropdown component | `SuggestionMenuController` | BlockNote's built-in handles positioning, keyboard nav, filtering |
| Diagram preview rendering | Custom SVG renderer | Existing `DiagramView` component | Already handles theme, aspect ratio, empty state, deleted state |
| User avatar display | Custom avatar component | Existing `Avatar`/`AvatarImage`/`AvatarFallback` | Used consistently across app |
| Permission checks | Ad-hoc permission logic | Existing Convex query patterns (by_workspace_user, by_project_user) | Consistent with rest of app |
| Deleted entity handling | Custom null checks | Existing pattern from DiagramBlock ("not found. may have been deleted") | User-facing consistency |

**Key insight:** BlockNote's extensibility is designed for these use cases. Fighting the framework (e.g., custom blocks when inline content is appropriate) leads to complexity. Existing components (DiagramView, Avatar) already handle edge cases (deleted, empty, loading).

## Common Pitfalls

### Pitfall 1: Confusing Blocks vs Inline Content
**What goes wrong:** Trying to use custom blocks in task descriptions
**Why it happens:** DiagramBlock exists as a block in DocumentEditor
**How to avoid:** Create separate DiagramEmbed inline content type for task descriptions
**Warning signs:** "Block spec not found" errors, schema validation failures

### Pitfall 2: Schema Mismatch Between Editor and Renderer
**What goes wrong:** Editor saves inline content that renderer doesn't recognize
**Why it happens:** MessageRenderer (for chat) and task description renderer must support same inline content types
**How to avoid:** Share schema definition between TaskDetailSheet and any renderer that displays task descriptions
**Warning signs:** Inline content disappears after save/reload

### Pitfall 3: Permission Leaks in Autocomplete
**What goes wrong:** User sees documents/projects they shouldn't access in autocomplete
**Why it happens:** Autocomplete queries without permission checks
**How to avoid:** Use existing permission patterns:
  - Documents: `documents.listByUserMembership` (filters by documentMembers)
  - Diagrams: `diagrams.list` (filters by workspaceMembers)
  - Projects: `projects.listByUserMembership` (filters by projectMembers)
  - Users: `projectMembers.membersByProject` (scoped to specific project)
**Warning signs:** User reports seeing items they can't access

### Pitfall 4: Stale Data in Inline Content
**What goes wrong:** Diagram/document name doesn't update when changed
**Why it happens:** Storing name in inline content props (like taskTitle in task mentions)
**How to avoid:** Store only ID in props, query fresh data at render time
**Warning signs:** Names out of sync with actual entities

### Pitfall 5: Read-Only Mode Implementation
**What goes wrong:** Diagram embeds allow editing when they should be read-only
**Why it happens:** Excalidraw component defaults to editable
**How to avoid:** For diagrams in task descriptions:
  - Use `exportToSvg` approach (like DiagramBlock does)
  - Render SVG, not interactive Excalidraw component
  - Wrap in click handler to navigate (not edit)
**Warning signs:** User can interact with diagram elements in task description

### Pitfall 6: Multiple # Triggers Conflicting
**What goes wrong:** Both task mentions and document/diagram/project picker triggered by #
**Why it happens:** Two SuggestionMenuController components with same trigger
**How to avoid:**
  - Task mentions are inserted in MessageComposer (chat only)
  - Document/diagram/project references are inserted in TaskDetailSheet (task descriptions only)
  - Different contexts, no conflict
**Warning signs:** Autocomplete shows wrong items

### Pitfall 7: Project Reference in Wrong Context
**What goes wrong:** Project references work in task descriptions but not chat messages (or vice versa)
**Why it happens:** Schema not extended in both contexts
**How to avoid:** Add projectReference inline content to both:
  - MessageComposer schema (for chat messages)
  - TaskDetailSheet schema (for task descriptions)
**Warning signs:** Project references disappear in one context

## Code Examples

Verified patterns from existing codebase:

### Creating Custom Inline Content
```typescript
// Source: src/pages/App/Chat/CustomInlineContent/TaskMention.tsx
export const TaskMention = createReactInlineContentSpec(
  {
    type: "taskMention",
    propSchema: {
      taskId: {
        default: "" as unknown as string,
      },
      taskTitle: {
        default: "",
      },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { taskId, taskTitle } = inlineContent.props;

      if (!taskId) {
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5
                           rounded-full bg-destructive/20 text-sm">
            #unknown-task
          </span>
        );
      }

      return (
        <span
          data-task-id={taskId}
          data-content-type="task-mention"
          className="inline-flex items-center gap-1.5 px-2 py-0.5
                     rounded-full bg-muted text-sm font-medium cursor-default"
        >
          <span className="h-2 w-2 rounded-full bg-gray-400" />
          <span className="max-w-50 truncate">{taskTitle || "Task"}</span>
        </span>
      );
    },
  }
);
```

### Combined Autocomplete Picker
```typescript
// Source: src/pages/App/Chat/MessageComposer.tsx
<SuggestionMenuController
  triggerCharacter={"#"}
  getItems={async (query) => {
    const tasksToSearch = linkedProject ? projectTasks : myTasks;
    if (!tasksToSearch) return [];

    return tasksToSearch
      .filter((task) =>
        task.title.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 10)
      .map((task) => ({
        title: task.title,
        onItemClick: () => {
          editor.insertInlineContent([
            {
              type: "taskMention",
              props: {
                taskId: task._id,
                taskTitle: task.title,
              },
            },
            " ",
          ]);
        },
        icon: <div className={cn("h-3 w-3 rounded-full", task.status?.color)} />,
        group: linkedProject ? "Project tasks" : "My tasks",
        key: task._id,
      }));
  }}
/>
```

### Diagram Preview Rendering
```typescript
// Source: src/pages/App/Document/CustomBlocks/DiagramBlock.tsx
const DiagramView = ({
  diagramId,
  onAspectRatioChange,
}: {
  diagramId: Id<"diagrams">;
  onAspectRatioChange?: (ratio: number) => void;
}) => {
  const diagram = useQuery(api.diagrams.get, { id: diagramId });
  const [svg, setSvg] = useState<string | null>(null);
  const sanitize = useSanitize();
  const sanitizedSvg = svg ? sanitize(svg) : "";
  const { resolvedTheme } = useTheme();

  // Parse elements
  const parsedElements = (() => {
    if (!diagram?.content) return null;
    try {
      const scene = JSON.parse(diagram.content);
      const elements = (scene.elements as NonDeleted<ExcalidrawElement>[])
        .filter((e) => e.isDeleted !== true);
      return elements.length > 0 ? elements : null;
    } catch (e) {
      console.error("Failed to parse diagram", e);
      return null;
    }
  })();

  const isDiagramEmpty = diagram !== undefined && diagram !== null && !parsedElements;

  // Export to SVG
  useEffect(() => {
    if (!parsedElements) return;

    let cancelled = false;
    const isDarkMode = resolvedTheme === "dark";
    const appState: Partial<AppState> = {
      theme: isDarkMode ? "dark" : "light",
      exportBackground: false,
      exportWithDarkMode: isDarkMode,
      exportEmbedScene: true,
    };

    exportToSvg({
      elements: parsedElements,
      appState,
      files: {},
      exportingFrame: null,
    }).then((svgElement: SVGSVGElement) => {
      if (cancelled) return;
      svgElement.setAttribute("width", "100%");
      svgElement.setAttribute("height", "100%");
      setSvg(svgElement.outerHTML);
    });

    return () => { cancelled = true; };
  }, [parsedElements, resolvedTheme, onAspectRatioChange]);

  if (diagram === undefined) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (diagram === null) {
    return (
      <div className="w-full flex flex-col items-center justify-center
                      p-4 border rounded-lg text-center text-muted-foreground
                      bg-secondary h-40 gap-2">
        <CircleSlash className="h-10 w-10 text-destructive" />
        <p className="text-destructive">
          Diagram not found. It may have been deleted.
        </p>
      </div>
    );
  }

  if (isDiagramEmpty) {
    return (
      <div className="w-full flex flex-col items-center justify-center
                      p-4 text-center text-muted-foreground bg-secondary h-40 gap-2">
        <p>This diagram is empty.</p>
        <p className="text-sm">Edit the diagram to add content.</p>
      </div>
    );
  }

  if (!svg || !sanitizedSvg) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div
      className="w-full h-full"
      dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
    />
  );
};
```

### Deleted Entity Handling
```typescript
// Source: src/pages/App/Chat/TaskMentionChip.tsx
export function TaskMentionChip({ taskId }: TaskMentionChipProps) {
  const task = useQuery(api.tasks.get, {
    taskId: taskId as Id<"tasks">,
  });
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  if (!task) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5
                       rounded-full bg-background/60 text-muted-foreground
                       text-sm align-middle">
        #deleted-task
      </span>
    );
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigate(`/workspaces/${workspaceId}/projects/${task.projectId}`, {
      state: { highlightTaskId: taskId },
    });
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 px-2 py-0.5
                 rounded-full bg-background/60 hover:bg-background/80
                 transition-colors cursor-pointer text-sm font-medium align-middle"
    >
      <span className={cn("h-2 w-2 rounded-full shrink-0", task.status?.color)} />
      <span className="max-w-50 truncate">{task.title}</span>
    </button>
  );
}
```

### Permission-Scoped Queries
```typescript
// Source: convex/diagrams.ts
export const list = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(diagramValidator),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Check workspace membership
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();

    if (!workspaceMembership)
      throw new ConvexError("User is not a member of workspace");

    return ctx.db
      .query("diagrams")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .collect();
  },
});

// Source: convex/documents.ts
export const listByUserMembership = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(documentValidator),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const documentMembers = await ctx.db
      .query("documentMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const documentIds = documentMembers.map((m) => m.documentId);
    const documents = await getAll(ctx.db, documentIds);

    return documents
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .filter((document) => document.workspaceId === workspaceId);
  },
});

// Source: convex/projectMembers.ts
export const membersByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(projectMemberValidator),
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const project = await ctx.db.get(projectId);
    if (!project) throw new ConvexError("Project not found");

    const members = await ctx.db
      .query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    return Promise.all(
      members.map(async (member) => {
        const user = await ctx.db.get(member.userId);
        if (!user) return null;
        return {
          ...member,
          name: user.name ?? user.email ?? "unknown",
          image: user.image,
          isCreator: member.userId === project.creatorId,
        };
      })
    ).then((results) => results.filter((r): r is NonNullable<typeof r> => r !== null));
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom blocks for all embeds | Inline content for text-flow elements | BlockNote 0.46.2 | Inline content is lighter, works in simple schemas |
| Separate autocomplete triggers | Combined picker with grouping | BlockNote 0.46.2 | Single `#` trigger, groups differentiate types |
| Interactive diagram embeds | Read-only SVG previews with click-to-edit | Excalidraw 0.18.0 | Cleaner UX, prevents accidental edits |
| Store entity names in inline content | Store only IDs, query fresh data | Phase 4 pattern | Names stay in sync with source of truth |

**Deprecated/outdated:**
- BlockNote's old `createInlineContent` (pre-0.46): Now `createReactInlineContentSpec` with type-safe config
- Excalidraw's `viewModeEnabled` prop: Use `exportToSvg` for static previews instead

## Open Questions

Things that couldn't be fully resolved:

1. **Should diagram embeds in task descriptions be actual inline content or block-level?**
   - What we know: DiagramBlock is currently a custom block in DocumentEditor
   - What's unclear: Can inline content render block-level (non-text) elements?
   - Recommendation: Test inline content with `<div>` wrapper for diagram. If BlockNote enforces inline-only HTML, fall back to creating simplified diagram block for task schema.

2. **Should @mentions in task descriptions navigate somewhere or just display?**
   - What we know: User decision says "click action: None (display only)"
   - What's unclear: This differs from task mentions (which navigate) - is display-only intentional?
   - Recommendation: Follow user decision literally - no onClick handler. This makes @mentions lightweight (just for visibility/attribution).

3. **Should project references show live member count or static snapshot?**
   - What we know: Project chip shows name and color
   - What's unclear: Whether to query project.memberCount at render time
   - Recommendation: Query fresh data (like task mentions do for status color). Minimal cost, shows accurate state.

## Sources

### Primary (HIGH confidence)
- [BlockNote Custom Inline Content](https://www.blocknotejs.org/docs/custom-schemas/custom-inline-content) - API documentation
- [BlockNote Suggestion Menus](https://www.blocknotejs.org/docs/react/components/suggestion-menus) - SuggestionMenuController documentation
- Existing codebase patterns:
  - `src/pages/App/Chat/CustomInlineContent/TaskMention.tsx` - Inline content pattern
  - `src/pages/App/Document/CustomBlocks/DiagramBlock.tsx` - Diagram rendering pattern
  - `src/pages/App/Chat/MessageComposer.tsx` - Multiple SuggestionMenuController pattern
  - `convex/diagrams.ts`, `convex/documents.ts`, `convex/projects.ts` - Permission patterns

### Secondary (MEDIUM confidence)
- [Excalidraw Props Documentation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/) - viewModeEnabled prop
- [Excalidraw Export Utilities](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export) - exportToSvg usage

### Tertiary (LOW confidence)
- None - all findings verified with official documentation or existing code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, versions verified
- Architecture: HIGH - Patterns proven in existing codebase (Phase 4)
- Pitfalls: HIGH - Documented from codebase analysis and BlockNote docs
- Open questions: MEDIUM - Implementation choices that need testing

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - BlockNote and Excalidraw are stable)
