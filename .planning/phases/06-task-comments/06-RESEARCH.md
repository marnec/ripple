# Phase 06: Task Comments - Research

**Researched:** 2026-02-06
**Domain:** Real-time commenting system with Convex backend
**Confidence:** HIGH

## Summary

Task comments in Ripple should follow the established pattern from channel messages, which already demonstrates a proven architecture for real-time threaded discussions. The codebase uses Convex for backend with optimistic updates, BlockNote for rich text, and project membership for permissions.

Key findings:
- **Reuse message patterns**: The existing `messages` table and mutations provide a battle-tested template for comments
- **Simple permission model**: Project membership check (via `projectMembers.by_project_user` index) + author-only edit/delete
- **Optimistic updates**: Convex's `.withOptimisticUpdate()` provides instant UI feedback for create/edit/delete operations
- **Pagination optional**: For v1, standard chronological list without pagination is sufficient (can add later if needed)
- **Rich text vs simple**: Start with simple textarea for comments (not BlockNote) to reduce complexity - comments are shorter than task descriptions

**Primary recommendation:** Model `taskComments` table after existing `messages` table, reuse permission patterns from `tasks.ts`, implement author-only edit/delete like messages, and use simple textarea with Submit button (not BlockNote's full editor).

## Standard Stack

The established libraries/tools for real-time commenting in this codebase:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Convex | Current | Real-time database + mutations | Already used for messages, tasks - reactive queries auto-update UI |
| React 18 | 18.x | UI framework | Existing frontend stack |
| Tailwind CSS | Current | Styling | Existing UI styling approach |
| shadcn/ui | Current | Component library | Existing component system (Button, Input, ScrollArea, Avatar) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@convex-dev/auth` | Current | User authentication | Already used in all backend functions via `getAuthUserId()` |
| `convex-helpers` | Current | Relationship helpers | Use `getAll()` for batch fetching user data (already used in messages.ts) |
| `usehooks-ts` | Current | React hooks utilities | Use `useResizeObserver` if implementing auto-scroll (used in MessageList) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Simple textarea | BlockNote editor | BlockNote adds complexity - overkill for short comments. Use textarea for v1. |
| Real-time list | Paginated comments | Pagination adds complexity - defer until comments become numerous |
| Soft delete | Hard delete | Soft delete (`deleted: boolean`) matches message pattern and allows audit trail |

**Installation:**
```bash
# No new packages needed - all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
convex/
├── taskComments.ts          # New file: mutations and queries for comments
└── schema.ts                # Add taskComments table definition

src/pages/App/Project/
├── TaskDetailSheet.tsx      # Add CommentList below description section
├── CommentList.tsx          # New component: display comments chronologically
└── CommentInput.tsx         # New component: textarea + submit button
```

### Pattern 1: Table Schema (Follow Messages Pattern)
**What:** Define `taskComments` table similar to `messages` table with indexed foreign keys
**When to use:** This is the foundation - implement first
**Example:**
```typescript
// Source: convex/schema.ts (existing messages pattern)
taskComments: defineTable({
  taskId: v.id("tasks"),           // parent task
  userId: v.id("users"),            // comment author
  body: v.string(),                 // comment text (plain text, no rich formatting for v1)
  deleted: v.boolean(),             // soft delete flag
})
  .index("by_task", ["taskId"])
  .index("undeleted_by_task", ["taskId", "deleted"]),
```

**Key decisions:**
- Use `body: v.string()` for plain text (not JSON like messages - simpler for v1)
- Include soft delete flag `deleted: boolean` (matches message pattern)
- Index on `taskId` for efficient querying
- Composite index `["taskId", "deleted"]` enables filtered queries

### Pattern 2: Permission Model (Project Membership)
**What:** Check project membership via `projectMembers.by_project_user` index
**When to use:** In all queries and mutations to validate access
**Example:**
```typescript
// Source: convex/tasks.ts (existing permission pattern)
// 1. Get task to find its projectId
const task = await ctx.db.get(taskId);
if (!task) throw new ConvexError("Task not found");

// 2. Validate membership on task's project
const membership = await ctx.db
  .query("projectMembers")
  .withIndex("by_project_user", (q) =>
    q.eq("projectId", task.projectId).eq("userId", userId)
  )
  .first();

if (!membership) {
  throw new ConvexError("Not a member of this project");
}
```

**Key insight:** Always validate project membership through the task's project - never assume task access implies comment access.

### Pattern 3: Author-Only Edit/Delete
**What:** Only comment author can edit/delete their own comments
**When to use:** In update and remove mutations
**Example:**
```typescript
// Source: convex/messages.ts (existing pattern)
export const update = mutation({
  args: { id: v.id("taskComments"), body: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, body }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const comment = await ctx.db.get(id);
    if (!comment) throw new ConvexError("Comment not found");

    // Author check
    if (comment.userId !== userId) {
      throw new ConvexError("Not authorized to update this comment");
    }

    await ctx.db.patch(id, { body });
    return null;
  },
});
```

### Pattern 4: Batch User Fetching (N+1 Query Prevention)
**What:** Use `getAll()` from convex-helpers to fetch all comment authors in one batch
**When to use:** When listing comments with author information
**Example:**
```typescript
// Source: convex/messages.ts lines 56-64
import { getAll } from "convex-helpers/server/relationships";

// Batch fetch all users for the comments
const userIds = [...new Set(comments.map((c) => c.userId))];
const users = await getAll(ctx.db, userIds);
const userMap = new Map(users.map((u, i) => [userIds[i], u]));

// Add the author's name to each comment
const commentsWithAuthor = comments.map((comment) => {
  const user = userMap.get(comment.userId);
  return { ...comment, author: user?.name ?? user?.email ?? "Unknown" };
});
```

**Why:** Prevents N+1 query problem - fetches all users in one operation instead of querying for each comment.

### Pattern 5: Optimistic Updates for Instant UI
**What:** Use Convex's `.withOptimisticUpdate()` to update UI before server confirms
**When to use:** For create, update, and delete operations to make UI feel instant
**Example:**
```typescript
// Source: Convex docs - https://docs.convex.dev/client/react/optimistic-updates
// Frontend usage:
const addComment = useMutation(api.taskComments.create)
  .withOptimisticUpdate((localStore, args) => {
    // Get current comments
    const comments = localStore.getQuery(api.taskComments.list, {
      taskId: args.taskId
    });

    if (comments === undefined) return; // Query not loaded yet

    // Create temporary comment (will be replaced when mutation completes)
    const optimisticComment = {
      _id: crypto.randomUUID() as Id<"taskComments">, // temp ID
      _creationTime: Date.now(),
      userId: currentUser._id,
      taskId: args.taskId,
      body: args.body,
      deleted: false,
      author: currentUser.name || currentUser.email,
    };

    // CRITICAL: Create new array (don't mutate!)
    const updatedComments = [...comments, optimisticComment];

    localStore.setQuery(api.taskComments.list, { taskId: args.taskId }, updatedComments);
  });
```

**CRITICAL:** Always create new arrays/objects - never mutate existing ones. Convex requires immutability in optimistic updates.

### Pattern 6: Simple Comment UI (Not Rich Text)
**What:** Use textarea + submit button instead of BlockNote editor
**When to use:** For comment input (simpler than task descriptions)
**Example:**
```typescript
// Simple textarea component pattern
function CommentInput({ taskId, onSubmit }) {
  const [body, setBody] = useState("");
  const addComment = useMutation(api.taskComments.create);

  const handleSubmit = () => {
    if (!body.trim()) return;
    void addComment({ taskId, body: body.trim() });
    setBody(""); // Clear input
  };

  return (
    <div className="flex gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment..."
        className="flex-1 resize-none border rounded-md p-2"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />
      <Button onClick={handleSubmit} disabled={!body.trim()}>
        Submit
      </Button>
    </div>
  );
}
```

**Why simpler than BlockNote:**
- Comments are typically short (1-3 sentences)
- Reduces cognitive load and implementation complexity
- Matches common task management UX (Linear, Asana, Jira all use simple inputs)
- Can upgrade to rich text later if users request it

### Anti-Patterns to Avoid
- **Pagination too early:** Don't implement pagination in v1 - adds complexity. Add later if tasks have 50+ comments.
- **Rich text overkill:** BlockNote is designed for long-form documents. Comments need simple textarea.
- **Direct mutation references:** Never store comment IDs on task document - query via index instead.
- **Inline editing everywhere:** Only show edit UI when user clicks "Edit" - don't make every comment editable by default.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| User batch fetching | Loop over comments and `await ctx.db.get(userId)` | `getAll()` from convex-helpers | N+1 query problem - your loop creates hundreds of DB queries. getAll batches them. |
| Optimistic updates | Manual state management with useState | Convex `.withOptimisticUpdate()` | Complex rollback logic, race conditions, stale data. Convex handles it. |
| Time formatting | Manual date formatting logic | `new Date(timestamp).toLocaleTimeString()` or `date-fns` | Timezone, locale, relative time ("2 hours ago") already solved. |
| Soft delete queries | Manual filtering after fetch | Composite index `["taskId", "deleted"]` | Filtering after fetch loads ALL comments into memory. Index filters at DB level. |

**Key insight:** The existing `messages.ts` file already solved these problems. Copy the patterns, don't reinvent.

## Common Pitfalls

### Pitfall 1: Mutating Objects in Optimistic Updates
**What goes wrong:** Using `.push()` on arrays or directly mutating objects causes Convex internal state corruption
**Why it happens:** JavaScript reference semantics - mutating the object that Convex tracks
**How to avoid:** Always use spread operators to create new arrays/objects
**Warning signs:** Comments appear then disappear, optimistic updates don't roll back properly
**Example:**
```typescript
// WRONG - mutates existing array
comments.push(newComment);

// CORRECT - creates new array
const updatedComments = [...comments, newComment];
```

### Pitfall 2: Not Checking Query Load State
**What goes wrong:** Optimistic update tries to access `undefined` query results, crashes or creates empty state
**Why it happens:** Queries load asynchronously - might not be ready when optimistic update runs
**How to avoid:** Guard with `if (comments === undefined) return;` at start of optimistic update
**Warning signs:** Console errors about undefined, comments disappear on refresh

### Pitfall 3: Forgetting Soft Delete in Queries
**What goes wrong:** Deleted comments reappear in UI
**Why it happens:** Query uses `by_task` index instead of `undeleted_by_task` composite index
**How to avoid:** Always query with `.withIndex("undeleted_by_task", q => q.eq("taskId", taskId).eq("deleted", false))`
**Warning signs:** Users report deleted comments coming back

### Pitfall 4: Permission Check Ordering
**What goes wrong:** Checking if comment exists AFTER checking permissions reveals existence of comments user shouldn't see
**Why it happens:** Wrong order of validation steps
**How to avoid:**
1. Get comment (404 if not exists)
2. Get task from comment.taskId
3. Check project membership
4. Then perform operation

**Warning signs:** Security vulnerability - users can probe for comment IDs

### Pitfall 5: Missing Return Validators
**What goes wrong:** TypeScript errors, Convex validation errors at runtime
**Why it happens:** New Convex syntax requires explicit `returns:` validator
**How to avoid:** Always add `returns: v.null()` for mutations, appropriate validator for queries
**Example:**
```typescript
export const create = mutation({
  args: { taskId: v.id("tasks"), body: v.string() },
  returns: v.null(), // REQUIRED
  handler: async (ctx, args) => { /* ... */ }
});
```

### Pitfall 6: Using filter() Instead of withIndex()
**What goes wrong:** Slow queries, especially as comment count grows
**Why it happens:** `.filter()` loads all documents into memory then filters - doesn't use indexes
**How to avoid:** Define indexes in schema, use `.withIndex()` in queries
**Codebase convention:** "Use withIndex() never filter() for indexed fields" (from CLAUDE.md)

## Code Examples

Verified patterns from existing codebase:

### List Comments Query (Based on messages.list)
```typescript
// Source: Adapted from convex/messages.ts lines 9-71
export const list = query({
  args: { taskId: v.id("tasks") },
  returns: v.array(v.object({
    _id: v.id("taskComments"),
    _creationTime: v.number(),
    userId: v.id("users"),
    taskId: v.id("tasks"),
    body: v.string(),
    deleted: v.boolean(),
    author: v.string(),
  })),
  handler: async (ctx, { taskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Unauthenticated");

    const task = await ctx.db.get(taskId);
    if (!task) throw new ConvexError("Task not found");

    // Check project membership (permission check)
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", task.projectId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new ConvexError("Not a member of this project");
    }

    // Query undeleted comments chronologically
    const comments = await ctx.db
      .query("taskComments")
      .withIndex("undeleted_by_task", (q) =>
        q.eq("taskId", taskId).eq("deleted", false)
      )
      .order("asc") // oldest first (chronological thread)
      .collect();

    // Batch fetch authors (prevent N+1)
    const userIds = [...new Set(comments.map((c) => c.userId))];
    const users = await getAll(ctx.db, userIds);
    const userMap = new Map(users.map((u, i) => [userIds[i], u]));

    // Enrich with author names
    return comments.map((comment) => {
      const user = userMap.get(comment.userId);
      return {
        ...comment,
        author: user?.name ?? user?.email ?? "Unknown"
      };
    });
  },
});
```

### Create Comment Mutation
```typescript
// Source: Adapted from convex/messages.ts lines 73-123
export const create = mutation({
  args: {
    taskId: v.id("tasks"),
    body: v.string(),
  },
  returns: v.id("taskComments"),
  handler: async (ctx, { taskId, body }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const task = await ctx.db.get(taskId);
    if (!task) throw new ConvexError("Task not found");

    // Check project membership
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", task.projectId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new ConvexError("Not a member of this project");
    }

    // Create comment
    const commentId = await ctx.db.insert("taskComments", {
      taskId,
      userId,
      body: body.trim(),
      deleted: false,
    });

    return commentId;
  },
});
```

### Edit Comment Mutation (Author-Only)
```typescript
// Source: convex/messages.ts lines 125-139
export const update = mutation({
  args: {
    id: v.id("taskComments"),
    body: v.string()
  },
  returns: v.null(),
  handler: async (ctx, { id, body }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const comment = await ctx.db.get(id);
    if (!comment) throw new ConvexError("Comment not found");

    // Author-only check
    if (comment.userId !== userId) {
      throw new ConvexError("Not authorized to update this comment");
    }

    await ctx.db.patch(id, { body: body.trim() });
    return null;
  },
});
```

### Delete Comment Mutation (Soft Delete)
```typescript
// Source: convex/messages.ts lines 141-155
export const remove = mutation({
  args: { id: v.id("taskComments") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const comment = await ctx.db.get(id);
    if (!comment) throw new ConvexError("Comment not found");

    // Author-only check
    if (comment.userId !== userId) {
      throw new ConvexError("Not authorized to delete this comment");
    }

    // Soft delete (preserve for audit trail)
    await ctx.db.patch(id, { deleted: true });
    return null;
  },
});
```

### Comment Display Component (UI Pattern)
```typescript
// Source: Adapted from src/pages/App/Chat/Message.tsx
function Comment({
  comment,
  currentUserId
}: {
  comment: CommentWithAuthor;
  currentUserId: Id<"users">
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const updateComment = useMutation(api.taskComments.update);
  const deleteComment = useMutation(api.taskComments.remove);

  const isAuthor = comment.userId === currentUserId;

  const handleSaveEdit = () => {
    void updateComment({ id: comment._id, body: editBody });
    setIsEditing(false);
  };

  const handleDelete = () => {
    void deleteComment({ id: comment._id });
  };

  return (
    <div className="flex gap-3 py-2">
      <Avatar className="h-8 w-8">
        <AvatarFallback>
          {comment.author.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-sm">{comment.author}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(comment._creationTime).toLocaleString()}
          </span>
        </div>

        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              className="w-full border rounded-md p-2 text-sm"
              rows={3}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveEdit}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
            {isAuthor && (
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsEditing(true)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDelete}
                >
                  Delete
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Mutations without validators | Explicit `args:` and `returns:` validators | Convex v1.0+ | Type safety at runtime, better TypeScript inference |
| Hard delete comments | Soft delete with `deleted: boolean` | Common pattern 2024+ | Audit trail, undo capability, data integrity |
| Client-side optimistic updates | Convex `.withOptimisticUpdate()` | Convex built-in feature | Framework handles rollback, race conditions |
| Rich text for all inputs | Simple textarea for short-form content | UX best practice | Reduced complexity, faster interaction for comments |

**Deprecated/outdated:**
- **Old Convex function syntax:** Functions without explicit validators (pre-v1.0) - use new syntax with `args:` and `returns:`
- **N+1 queries:** Looping to fetch related data - use `getAll()` from convex-helpers
- **filter() for indexed fields:** Loading all documents then filtering - use `.withIndex()` queries

## Open Questions

Things that couldn't be fully resolved:

1. **Comment pagination threshold**
   - What we know: Pagination adds complexity, not needed for v1
   - What's unclear: At what comment count does pagination become necessary? 50? 100? 500?
   - Recommendation: Implement without pagination. Monitor performance. Add pagination if tasks regularly exceed 50 comments.

2. **Real-time notifications for new comments**
   - What we know: Messages have push notifications (lines 113-120 in messages.ts)
   - What's unclear: Should comments also trigger push notifications? Could be noisy.
   - Recommendation: Skip notifications for v1. Real-time updates via Convex reactivity are sufficient. Add opt-in notifications in later phase if requested.

3. **@mention support in comments**
   - What we know: Task descriptions support @mentions via BlockNote
   - What's unclear: Do comments need @mentions? Adds significant complexity to textarea approach.
   - Recommendation: Skip for v1 (use simple textarea). If users request mentions, upgrade to BlockNote in v2.

4. **Comment edit history**
   - What we know: Current pattern doesn't track edit history
   - What's unclear: Do users need to see "edited" indicator or full edit history?
   - Recommendation: Add `edited: v.boolean()` field in v1 to show "(edited)" label. Full history can be added later if needed.

## Sources

### Primary (HIGH confidence)
- Convex Official Docs - Optimistic Updates: https://docs.convex.dev/client/react/optimistic-updates
- Convex Official Docs - Pagination: https://docs.convex.dev/database/pagination
- Existing codebase - convex/messages.ts (lines 9-297): Real-time message system with soft delete, batch fetching, permission checks
- Existing codebase - convex/tasks.ts (lines 26-419): Project membership permission pattern
- Existing codebase - convex/schema.ts (lines 21-31): Messages table structure and indexes

### Secondary (MEDIUM confidence)
- [Confluence Comment Permissions](https://confluence.atlassian.com/doc/comment-on-pages-and-blog-posts-139483.html) - Standard author-only edit/delete pattern
- [Convex Stack Article - Real-time Collaboration](https://stack.convex.dev/keeping-real-time-users-in-sync-convex) - Real-time patterns and optimistic updates
- [BlockNote Official Docs](https://www.blocknotejs.org/docs) - Editor capabilities (determined overkill for comments)

### Tertiary (LOW confidence - general patterns only)
- [React Comment System Patterns](https://diederik-mathijs.medium.com/create-a-comment-system-using-1-react-hook-4169ba8f4d6a) - General React patterns
- [Telerik Blog - Textarea vs Rich Text Editor](https://www.telerik.com/blogs/react-editor-text-area-how-choose) - UX considerations for input types

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, patterns proven in messages.ts
- Architecture: HIGH - Direct adaptation of existing message patterns to comments
- Pitfalls: HIGH - Documented from actual Convex docs and codebase conventions
- UI patterns: MEDIUM - Simple textarea is standard but not verified with user testing

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - stable domain, Convex patterns unlikely to change)

**Key assumptions:**
1. Comments volume will be low-to-moderate (< 50 per task) - no pagination needed
2. Users prefer simple, fast comment input over rich formatting
3. Project membership is sufficient permission model (no comment-specific roles)
4. Chronological ordering (oldest first) matches user mental model for comment threads

**Validation needed during planning:**
- Confirm UI placement: comments below task description in TaskDetailSheet
- Confirm no rich text needed for v1 (can upgrade later)
- Confirm soft delete is acceptable (vs hard delete)
- Confirm author-only edit/delete is sufficient (vs project admin can also delete)
