# Architecture Patterns: Projects & Tasks Integration

**Domain:** Task Management in Real-Time Collaborative Workspace
**Researched:** 2026-02-05
**Confidence:** HIGH

## Executive Summary

Integrating Projects and Tasks into Ripple's existing Convex architecture requires following established patterns: membership tables for access control, junction tables for many-to-many relationships, compound indexes for efficient queries, and ID references for cross-entity relationships. The existing codebase demonstrates robust patterns that can be directly applied to task management.

## Recommended Architecture

### System Overview

```
Workspaces (existing)
    ├── Channels (existing) ─────┐
    ├── Documents (existing)      │
    ├── Diagrams (existing)       │
    └── Projects (new)            │
            ├── Tasks (new)       │
            │   ├── References ───┼─── Documents/Diagrams/Users
            │   └── Dependencies  │
            └── Members (new)     │
                                  │
        ProjectChannels (new) ────┘
```

### Component Boundaries

| Component | Responsibility | Data Ownership | Access Pattern |
|-----------|---------------|----------------|----------------|
| **projects** | Project metadata (name, description, status) | Projects table | Workspace-scoped, membership-filtered |
| **projectMembers** | Project access control & roles | ProjectMembers junction table | User-project authorization |
| **tasks** | Task data (title, status, assignee, priority, due date) | Tasks table | Project-scoped |
| **taskDependencies** | Task ordering & dependency graph | TaskDependencies junction table | Task-to-task relationships |
| **projectChannels** | Project-channel associations | ProjectChannels junction table | Many-to-many linking |
| **taskReferences** | Embedded entity references | Stored in task body/metadata | ID references to documents/diagrams/users |

## Schema Design

### Core Tables

#### projects
```typescript
projects: defineTable({
  workspaceId: v.id("workspaces"),
  name: v.string(),
  description: v.optional(v.string()),
  status: v.union(
    v.literal("active"),
    v.literal("archived"),
    v.literal("completed")
  ),
  roleCount: v.object({
    admin: v.number(),
    member: v.number(),
  }),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_status", ["workspaceId", "status"])
  .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] })
```

**Rationale:**
- Mirrors `documents` pattern with roleCount for efficient UI display
- Compound index `by_workspace_status` enables filtered project lists (active vs archived)
- Search index enables project search within workspace context

#### projectMembers
```typescript
projectMembers: defineTable({
  projectId: v.id("projects"),
  userId: v.id("users"),
  workspaceId: v.id("workspaces"), // Denormalized for efficient queries
  role: v.union(v.literal("admin"), v.literal("member")),
})
  .index("by_project", ["projectId"])
  .index("by_user", ["userId"])
  .index("by_project_user", ["projectId", "userId"])
  .index("by_workspace_user", ["workspaceId", "userId"])
  .index("by_project_role", ["projectId", "role"])
```

**Rationale:**
- Exact pattern from `documentMembers` and `channelMembers`
- Denormalized `workspaceId` enables efficient "all projects for user in workspace" queries
- `by_project_user` supports unique constraint checking and authorization
- `by_project_role` enables admin-only queries (e.g., settings page)

#### tasks
```typescript
tasks: defineTable({
  projectId: v.id("projects"),
  title: v.string(),
  description: v.optional(v.string()),
  status: v.union(
    v.literal("backlog"),
    v.literal("todo"),
    v.literal("in_progress"),
    v.literal("review"),
    v.literal("done")
  ),
  assigneeId: v.optional(v.id("users")),
  createdBy: v.id("users"),
  priority: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
    v.literal("urgent")
  ),
  dueDate: v.optional(v.number()), // Unix timestamp
  sortOrder: v.number(), // For Kanban column ordering
  // Embedded references (stored as structured data)
  references: v.optional(v.object({
    documents: v.optional(v.array(v.id("documents"))),
    diagrams: v.optional(v.array(v.id("diagrams"))),
    messages: v.optional(v.array(v.id("messages"))),
  })),
  parentTaskId: v.optional(v.id("tasks")), // For subtasks
})
  .index("by_project", ["projectId"])
  .index("by_project_status", ["projectId", "status"])
  .index("by_assignee", ["assigneeId"])
  .index("by_project_assignee", ["projectId", "assigneeId"])
  .index("by_project_sortOrder", ["projectId", "sortOrder"])
  .index("by_parent", ["parentTaskId"])
  .searchIndex("by_title", { searchField: "title", filterFields: ["projectId"] })
```

**Rationale:**
- `by_project_status` is critical for Kanban view (query tasks by status column)
- `sortOrder` enables drag-and-drop reordering within status columns
- `by_project_assignee` supports "My Tasks" filtered views
- `parentTaskId` enables subtask hierarchies without separate table
- Embedded `references` object avoids separate junction table for simple references

**Why not separate reference tables?**
- Tasks typically reference 0-5 entities, well within Convex's array limits
- Avoids additional queries when loading task details
- Simplifies mutations (single document update vs multiple junction records)
- Can still query efficiently by ID with client-side filtering or custom indexes if needed

#### taskDependencies
```typescript
taskDependencies: defineTable({
  taskId: v.id("tasks"),
  dependsOnTaskId: v.id("tasks"),
  type: v.union(
    v.literal("blocks"), // taskId is blocked by dependsOnTaskId
    v.literal("relates_to"), // Weaker relationship
  ),
})
  .index("by_task", ["taskId"])
  .index("by_depends_on", ["dependsOnTaskId"])
  .index("by_task_type", ["taskId", "type"])
```

**Rationale:**
- Junction table pattern for many-to-many relationships
- `by_task` query: "What does this task depend on?"
- `by_depends_on` query: "What tasks depend on this?"
- Enables dependency graph traversal for both directions

**Alternative considered:** Embedded array of dependency IDs in tasks table
**Why junction table is better:**
- Bidirectional queries are equally efficient
- No 8192 array limit concerns for tasks with many dependencies
- Easier to add dependency metadata (type, created date, etc.)

#### projectChannels
```typescript
projectChannels: defineTable({
  projectId: v.id("projects"),
  channelId: v.id("channels"),
  workspaceId: v.id("workspaces"), // Denormalized
})
  .index("by_project", ["projectId"])
  .index("by_channel", ["channelId"])
  .index("by_project_channel", ["projectId", "channelId"])
```

**Rationale:**
- Junction table for many-to-many project-channel links
- `by_project_channel` ensures uniqueness and enables link existence checks
- Enables "Show all channels for this project" and "Show all projects for this channel"

### Index Strategy

#### Query Patterns & Index Selection

| Query | Index Used | Performance Impact |
|-------|-----------|-------------------|
| List all projects in workspace | `by_workspace` | O(projects in workspace) |
| List active projects only | `by_workspace_status` | O(active projects) - **significantly faster** |
| Get tasks for project | `by_project` | O(tasks in project) |
| Get tasks by status (Kanban column) | `by_project_status` | O(tasks in status) - **critical for Kanban** |
| Get user's assigned tasks | `by_assignee` | O(tasks assigned to user) |
| Get assigned tasks in project | `by_project_assignee` | O(assigned tasks in project) |
| Check project membership | `by_project_user` | O(1) - **unique lookup** |
| Get subtasks | `by_parent` | O(subtasks) |
| Get task dependencies | `by_task` | O(dependencies) |
| Search projects | `by_name` searchIndex | Full-text search |

#### Compound Index Best Practices

Following Convex documentation on [Introduction to Indexes and Query Performance](https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf):

1. **Order matters:** `by_workspace_status` enables queries filtering on workspace alone OR workspace+status, but not status alone
2. **Avoid redundancy:** `by_project` makes `by_project_status` potentially redundant for small projects, but the performance gain for Kanban views justifies the storage cost
3. **Denormalization:** Including `workspaceId` in `projectMembers` enables efficient workspace-scoped queries without joining through projects table

### Cross-Entity References

#### Pattern 1: Direct ID References (Tasks → Documents/Diagrams)

**Implementation:**
```typescript
// In task document
references: {
  documents: ["document_id_1", "document_id_2"],
  diagrams: ["diagram_id_1"],
}
```

**Resolution in queries:**
```typescript
// Using convex-helpers getAll
const documentIds = task.references?.documents || [];
const documents = await getAll(ctx.db, documentIds);
```

**When to use:**
- Small number of references (< 50 per task)
- References are read together with task details
- No need to query "all tasks referencing this document"

#### Pattern 2: Junction Tables (Task Dependencies)

**Implementation:**
```typescript
// Separate taskDependencies table
{ taskId: "task_1", dependsOnTaskId: "task_2" }
```

**Resolution in queries:**
```typescript
// Query dependencies
const deps = await ctx.db
  .query("taskDependencies")
  .withIndex("by_task", q => q.eq("taskId", taskId))
  .collect();
```

**When to use:**
- Many-to-many relationships (M:N)
- Need bidirectional queries
- Metadata on the relationship itself (dependency type, creation date)
- Potential for > 50 related items

#### Pattern 3: Denormalized References (Assignee)

**Implementation:**
```typescript
// Direct foreign key
assigneeId: "user_id"
```

**Resolution in queries:**
```typescript
// Batch fetch with getAll
const userIds = tasks.map(t => t.assigneeId);
const users = await getAll(ctx.db, userIds);
```

**When to use:**
- 1:1 or 1:many relationships
- Need to index by the reference (e.g., query tasks by assignee)
- Simple reference without additional metadata

### Real-Time Data Flow

#### Subscription Pattern

Convex's reactive architecture (from [Real-Time Database Guide](https://stack.convex.dev/real-time-database)) automatically tracks dependencies:

```typescript
// Client subscribes to query
const tasks = useQuery(api.tasks.listByProject, { projectId });

// Server mutation updates task
await ctx.db.patch(taskId, { status: "done" });

// Convex automatically:
// 1. Detects mutation affected query dependency
// 2. Reruns query function
// 3. Pushes update via WebSocket to subscribed clients
// 4. React re-renders with new data
```

**Key points:**
- No manual subscription management
- Queries define dependencies automatically
- Mutations trigger updates to affected subscriptions
- Optimistic updates handled client-side for perceived performance

#### Kanban Board Updates

```typescript
// User drags task to new column
// 1. Optimistic update (instant UI feedback)
setTasks(prev => prev.map(t =>
  t._id === taskId ? { ...t, status: newStatus } : t
));

// 2. Mutation to server
await updateTaskStatus({ taskId, status: newStatus });

// 3. Server processes mutation
await ctx.db.patch(taskId, { status: args.status });

// 4. Convex pushes update to ALL clients viewing this project
// 5. Other users see the task move in real-time
```

**Build order implication:** Real-time updates "just work" with Convex's reactive queries. No need for separate WebSocket layer or pub/sub.

### Message → Task Conversion

#### Architecture Decision

**Option A: Copy message content**
```typescript
{
  title: message.plainText.substring(0, 100),
  description: message.body,
  references: { messages: [messageId] }
}
```

**Option B: Reference only**
```typescript
{
  references: { messages: [messageId] }
}
```

**Recommendation: Option A (copy + reference)**

**Rationale:**
- Tasks need editable content (title/description)
- Messages are immutable once sent
- Reference preserves context ("created from message")
- Enables "jump to conversation" feature
- Deleting message doesn't lose task content

**Implementation:**
```typescript
export const createFromMessage = mutation({
  args: {
    messageId: v.id("messages"),
    projectId: v.id("projects")
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    // Verify permissions...

    return ctx.db.insert("tasks", {
      projectId: args.projectId,
      title: message.plainText.substring(0, 100),
      description: message.body,
      status: "backlog",
      createdBy: message.userId,
      references: { messages: [args.messageId] },
      // ... other defaults
    });
  }
});
```

## Data Access Patterns

### Authorization Model

Following the established pattern from documents/channels:

```typescript
// Pattern: Check membership before data access
export const listTasks = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Check project membership
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", q =>
        q.eq("projectId", projectId).eq("userId", userId)
      )
      .first();

    if (!membership) throw new ConvexError("Not a project member");

    // Query tasks
    return ctx.db
      .query("tasks")
      .withIndex("by_project", q => q.eq("projectId", projectId))
      .collect();
  }
});
```

**Key principle:** Authorization happens at query/mutation entry, not database level.

### Common Query Functions

Based on existing patterns in `documents.ts` and `channels.ts`:

```typescript
// List projects user has access to
export const listByUserMembership = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);

    // Get user's project memberships
    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_workspace_user", q =>
        q.eq("workspaceId", workspaceId).eq("userId", userId)
      )
      .collect();

    // Batch fetch projects
    const projectIds = memberships.map(m => m.projectId);
    return getAll(ctx.db, projectIds);
  }
});

// Get task with dependencies resolved
export const getWithDependencies = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    // Check permission...
    const task = await ctx.db.get(taskId);

    // Fetch dependencies
    const deps = await ctx.db
      .query("taskDependencies")
      .withIndex("by_task", q => q.eq("taskId", taskId))
      .collect();

    // Resolve dependent task details
    const depTaskIds = deps.map(d => d.dependsOnTaskId);
    const depTasks = await getAll(ctx.db, depTaskIds);

    return { task, dependencies: depTasks };
  }
});
```

## Architecture Patterns to Follow

### Pattern 1: Membership-Based Access Control

**What:** Every entity with access control has a corresponding `*Members` table with `by_entity_user` compound index.

**Example from codebase:**
- `documentMembers` → `documents`
- `channelMembers` → `channels`
- `workspaceMembers` → `workspaces`

**Apply to:**
- `projectMembers` → `projects`

**Benefits:**
- Consistent authorization pattern
- Efficient permission checks (O(1) lookup)
- Supports role-based permissions
- Enables "list accessible entities" queries

### Pattern 2: Denormalized Context IDs

**What:** Junction tables include higher-level context IDs for efficient filtering.

**Example from codebase:**
```typescript
channelMembers: {
  channelId: v.id("channels"),
  workspaceId: v.id("workspaces"), // Denormalized!
  userId: v.id("users"),
}
```

**Apply to:**
```typescript
projectMembers: {
  projectId: v.id("projects"),
  workspaceId: v.id("workspaces"), // Enables workspace-scoped queries
  userId: v.id("users"),
}
```

**Benefits:**
- Query "all projects for user in workspace" without joining
- Reduced query complexity
- Trade-off: Slightly more complex mutations (must maintain consistency)

### Pattern 3: Role Counts for UI Performance

**What:** Store aggregate role counts in entity documents for efficient display.

**Example from codebase:**
```typescript
documents: {
  roleCount: {
    admin: 3,
    member: 12,
  }
}
```

**Apply to:**
```typescript
projects: {
  roleCount: {
    admin: 2,
    member: 8,
  }
}
```

**Benefits:**
- Display member counts without counting query
- No N+1 query problem
- Trade-off: Must update on membership changes

**Implementation pattern from `documentMembers.ts`:**
```typescript
// On member add
await ctx.db.patch(projectId, {
  roleCount: {
    ...project.roleCount,
    [role]: project.roleCount[role] + 1,
  }
});

// On member remove
await ctx.db.patch(projectId, {
  roleCount: {
    ...project.roleCount,
    [role]: project.roleCount[role] - 1,
  }
});
```

### Pattern 4: Batch Fetching with getAll

**What:** Use `convex-helpers` `getAll()` to batch fetch related documents instead of N+1 queries.

**Example from codebase:**
```typescript
// From messages.ts
const userIds = [...new Set(messagesPage.page.map(m => m.userId))];
const users = await getAll(ctx.db, userIds);
const userMap = new Map(users.map((u, i) => [userIds[i], u]));
```

**Apply to:**
```typescript
// Fetch tasks with assignees
const tasks = await ctx.db.query("tasks").collect();
const assigneeIds = tasks.map(t => t.assigneeId).filter(Boolean);
const assignees = await getAll(ctx.db, assigneeIds);
```

**Benefits:**
- O(1) database round-trips instead of O(N)
- Significant performance improvement for lists
- Built-in by Convex helpers library

## Anti-Patterns to Avoid

### Anti-Pattern 1: Using .filter() Instead of Indexes

**What goes wrong:**
```typescript
// BAD: Scans all tasks in table
const tasks = await ctx.db
  .query("tasks")
  .filter(q => q.eq(q.field("projectId"), projectId))
  .collect();
```

**Why bad:** Scans every task document in the database, O(total tasks)

**Instead:**
```typescript
// GOOD: Uses index, only scans relevant range
const tasks = await ctx.db
  .query("tasks")
  .withIndex("by_project", q => q.eq("projectId", projectId))
  .collect();
```

**Prevention:** Define index in schema first, then write query using `.withIndex()`

**Source:** [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/)

### Anti-Pattern 2: Creating Redundant Indexes

**What goes wrong:**
```typescript
// Redundant indexes
.index("by_project", ["projectId"])
.index("by_project_status", ["projectId", "status"])
.index("by_project_assignee", ["projectId", "assigneeId"])
```

**Why bad:**
- Every index increases write overhead
- `by_project_status` can serve queries that only filter by `projectId`
- Storage cost multiplies with index count

**Evaluation:**
- `by_project` alone: Enables project-scoped queries, but must scan all tasks for status filtering
- `by_project_status`: Enables Kanban column queries (critical performance), can also serve project-only queries
- `by_project_assignee`: Enables "My Tasks in Project" queries

**Decision:** Keep all three because:
- `by_project_status` is NOT redundant - critical for Kanban performance
- `by_project_assignee` serves distinct query pattern
- Write overhead acceptable for task management (not high-frequency writes)

**Rule:** Redundant indexes are `by_a` + `by_a_b` where you NEVER filter by `b` independently.

### Anti-Pattern 3: Embedding Large or Unbounded Arrays

**What goes wrong:**
```typescript
// BAD: Array can grow without limit
tasks: {
  dependentTaskIds: v.array(v.id("tasks")), // Could be 100s
}
```

**Why bad:**
- Convex has 8192 item array limit
- Cannot index array fields
- Must scan all tasks to find "what depends on this task?"

**Instead:** Use junction table (`taskDependencies`)

**Prevention:** Use embedded arrays only for bounded collections (< 50 items, clear upper limit)

### Anti-Pattern 4: N+1 Query Pattern

**What goes wrong:**
```typescript
// BAD: Fetches user for each task individually
const tasks = await ctx.db.query("tasks").collect();
const tasksWithAssignees = await Promise.all(
  tasks.map(async task => ({
    ...task,
    assignee: await ctx.db.get(task.assigneeId)
  }))
);
```

**Why bad:** O(N) database queries for N tasks

**Instead:**
```typescript
// GOOD: Batch fetch all users at once
const tasks = await ctx.db.query("tasks").collect();
const assigneeIds = [...new Set(tasks.map(t => t.assigneeId).filter(Boolean))];
const assignees = await getAll(ctx.db, assigneeIds);
const assigneeMap = new Map(assignees.map((u, i) => [assigneeIds[i], u]));

const tasksWithAssignees = tasks.map(task => ({
  ...task,
  assignee: task.assigneeId ? assigneeMap.get(task.assigneeId) : null
}));
```

**Prevention:** Always batch fetch with `getAll()` when resolving multiple references

**Source:** Pattern from `messages.ts` line 41-45

### Anti-Pattern 5: Separate Task Status Table

**What goes wrong:**
```typescript
// BAD: Status as separate entity
taskStatuses: defineTable({
  taskId: v.id("tasks"),
  status: v.string(),
})
```

**Why bad:**
- Every status query requires join
- Status is 1:1 with task
- No benefit over storing status in task document

**Instead:** Status as field in task document

**Prevention:** Use separate tables only for many-to-many or when entity has independent lifecycle

## Build Order Recommendations

### Phase Structure Based on Dependencies

```
Phase 1: Projects Foundation
  ├─ Schema: projects, projectMembers
  ├─ Functions: create, list, get, rename, remove
  ├─ UI: Project list, project settings
  └─ Rationale: Establishes container before tasks

Phase 2: Basic Tasks
  ├─ Schema: tasks (without dependencies/references)
  ├─ Functions: create, list, update, remove
  ├─ UI: Task list view
  └─ Rationale: Core task CRUD before complex features

Phase 3: Kanban View
  ├─ Enhanced: Update task status & sortOrder
  ├─ Functions: reorderTasks mutation
  ├─ UI: Drag-and-drop Kanban board
  └─ Rationale: Requires Phase 2 tasks, uses existing real-time

Phase 4: Task References
  ├─ Enhanced: Add references field to tasks
  ├─ Functions: addReference, removeReference
  ├─ UI: Reference picker, embedded previews
  └─ Rationale: Builds on existing document/diagram queries

Phase 5: Task Dependencies
  ├─ Schema: taskDependencies
  ├─ Functions: addDependency, removeDependency, getDependencyGraph
  ├─ UI: Dependency visualization
  └─ Rationale: Complex feature, requires core tasks stable

Phase 6: Message → Task
  ├─ Functions: createFromMessage
  ├─ UI: Message action menu
  └─ Rationale: Integration feature, requires Phases 2+4

Phase 7: Project-Channel Links
  ├─ Schema: projectChannels
  ├─ Functions: linkChannel, unlinkChannel
  ├─ UI: Channel selector in project settings
  └─ Rationale: Nice-to-have integration
```

### Why This Order?

**Dependency flow:**
- Projects must exist before tasks (foreign key)
- Tasks must exist before dependencies (task-to-task links)
- Basic tasks needed before Kanban (status is just a field)
- References require stable task model

**Risk mitigation:**
- Phase 1-2 establish foundation (highest risk if wrong)
- Phase 3 adds value quickly (Kanban is core UX)
- Phase 4-5 are enhancements (can be deferred if needed)
- Phase 6-7 are integrations (lowest risk, highest complexity)

**Real-time consideration:**
- No special phases needed for real-time updates
- Convex reactive queries handle updates automatically
- Optimistic updates in UI layer (standard React pattern)

### Data Migration Considerations

**None required** - This is additive:
- New tables don't affect existing data
- No changes to existing schema
- Indexes are created at schema deploy time

**If modifying existing tables later:**
- Convex schema migrations are automatic for additive changes
- Breaking changes require migration functions
- Pattern: Create migration mutation, run once, deploy new schema

## Scalability Considerations

### At 100 Tasks per Project

**Approach:**
- Standard indexed queries work perfectly
- `.collect()` on task lists is fine
- No special optimization needed

**Bottlenecks:**
- None expected

### At 1,000 Tasks per Project

**Approach:**
- Consider pagination for task lists
- Kanban view still works (filtered by status)
- Dependency graph may need optimization

**Optimizations:**
```typescript
// Paginated task list
export const listPaginated = query({
  args: {
    projectId: v.id("projects"),
    paginationOpts: paginationOptsValidator
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("tasks")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .paginate(args.paginationOpts);
  }
});
```

**Source:** Pattern from `messages.ts` pagination

### At 10,000+ Tasks per Project

**Approach:**
- Mandatory pagination
- Consider archiving completed tasks
- Dependency graph queries need limits
- May need task count caching

**Optimizations:**
- Add `taskCount` to projects table (updated via trigger)
- Implement archive mechanism (soft delete with `archived: true`)
- Index: `by_project_archived_status` for filtering archived tasks

**Real-world context:**
- Most projects have < 1,000 tasks
- Jira recommends archiving projects > 5,000 issues
- This scale unlikely in typical workspace app

## Open Questions & Research Needs

### Question 1: Task Comments vs Message Threads

**Context:** Should tasks have dedicated comment threads or link to channel messages?

**Options:**
A. Separate `taskComments` table
B. Link task to channel, comments are channel messages
C. Both (comments + channel link)

**Needs research in phase:** Task detail view (Phase 4-5)

**Implications:**
- Option A: Simpler, but duplicates message infrastructure
- Option B: Reuses existing message code, but mixing contexts
- Option C: Most flexible, but more complex UX

**Recommendation:** Defer to phase-specific research. Lean toward Option B (link to channel) to avoid code duplication.

### Question 2: Task Templates

**Context:** Should projects support task templates (e.g., "Onboarding checklist")?

**Needs research in phase:** Project settings (post-MVP)

**Implications:**
- Requires template storage and instantiation logic
- Affects task creation UX
- May need separate `taskTemplates` table

**Recommendation:** Not in initial architecture. Add later if user research validates need.

### Question 3: Recurring Tasks

**Context:** Should tasks support recurrence (e.g., "Weekly standup")?

**Needs research in phase:** Advanced task features (post-MVP)

**Implications:**
- Requires cron-like scheduling in Convex
- Affects task data model (recurrence rule)
- May use Convex scheduled functions

**Recommendation:** Out of scope for initial architecture. Can be added later without schema changes (add optional `recurrence` field).

## Sources

### High Confidence (Official Documentation)

- [Convex Relationship Structures](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas) - Schema design patterns
- [Convex Database Relationship Helpers](https://stack.convex.dev/functional-relationships-helpers) - getManyVia and getAll patterns
- [Convex Schemas Documentation](https://docs.convex.dev/database/schemas) - Schema definition and indexes
- [Introduction to Indexes and Query Performance](https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf) - Index optimization
- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/) - Query patterns and anti-patterns
- [Real-Time Database Guide](https://stack.convex.dev/real-time-database) - Real-time subscription architecture

### Medium Confidence (Verified Patterns)

- [Kanban Data Model Patterns](https://medium.com/@agrawalkanishk3004/kanban-board-ui-system-design-35665fbf85b5) - Kanban schema structure
- [Task Dependencies in Project Management](https://activecollab.com/blog/project-management/task-dependencies-for-better-project-management) - Dependency types and patterns
- [Entity Relationship Diagrams Guide](https://www.geeksforgeeks.org/sql/how-to-design-er-diagrams-for-project-management-software/) - Cross-entity relationships

### Implementation Evidence (Existing Codebase)

- `/convex/schema.ts` - Membership table pattern, roleCount pattern, compound indexes
- `/convex/documents.ts` - Entity CRUD pattern, authorization pattern, getAll usage
- `/convex/messages.ts` - Pagination pattern, batch fetching with getAll
- `/convex/channelMembers.ts` - Junction table pattern, denormalized context IDs
- `/convex/diagrams.ts` - Workspace-scoped entity pattern

---

**Research confidence: HIGH** - Patterns directly derived from existing codebase and official Convex documentation. Cross-entity reference patterns verified through WebSearch and confirmed against existing code.

**Ready for roadmap:** Yes. Schema design is comprehensive, build order is clear, and patterns follow established conventions.
