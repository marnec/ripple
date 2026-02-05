# Phase 1: Projects Foundation - Research

**Researched:** 2026-02-05
**Domain:** Project containers with membership-based access control in Convex/React
**Confidence:** HIGH

## Summary

Phase 1 implements project containers following established patterns from channels and documents. The codebase already demonstrates mature patterns for entity creation, membership management, and role-based access control (RBAC) that should be replicated for projects.

The standard approach mirrors existing channels/documents architecture:
- Entity table with metadata (name, color, workspaceId)
- Membership join table with indexes for bi-directional queries
- Convex mutations with inline authorization checks
- Sidebar integration using shadcn/ui collapsible groups
- React Hook Form + Zod for form validation
- Settings page for membership management

Key discovery: The project must auto-create a dedicated channel that inherits project membership, requiring atomic cross-table operations within a single Convex mutation.

**Primary recommendation:** Follow the established channel/document patterns exactly — schema structure, query indexes, authorization checks, and UI components are already proven and working.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Convex | Current (from existing setup) | Backend database, queries, mutations, auth | Already integrated; provides real-time sync, transactions, type safety |
| React Hook Form | 7.x | Form state management | Already used in CreateChannelDialog; minimal re-renders, excellent DX |
| Zod | 3.x | Schema validation | Already used throughout; TypeScript-native, runtime safety |
| shadcn/ui | Current | UI components | Already integrated; consistent design system |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @hookform/resolvers | Latest | Connect Zod to React Hook Form | All forms (via zodResolver) |
| convex-helpers | Current | Relationship helpers (getAll) | Batch fetching related documents |
| lucide-react | Current | Icons | Sidebar icons (consistent with existing) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Convex | Supabase/Firebase | Convex already integrated; provides superior type safety and transactions |
| React Hook Form | Formik | RHF already standard in codebase; better performance |
| Zod | Yup | Zod already standard; better TypeScript integration |

**Installation:**
No new packages needed — all dependencies already in project.

## Architecture Patterns

### Recommended Project Structure

Projects follow the established entity pattern in the codebase:

```
convex/
├── schema.ts                    # Add projects + projectMembers tables
├── projects.ts                  # CRUD operations (mirror channels.ts)
├── projectMembers.ts            # Membership management (mirror channelMembers.ts)
└── channels.ts                  # Extend to support linkedProjectId

src/pages/App/
└── Project/
    ├── ProjectSelectorList.tsx      # Sidebar list (mirror ChannelSelectorList)
    ├── ProjectSelectorItem.tsx      # Sidebar item (mirror ChannelSelectorItem)
    ├── CreateProjectDialog.tsx      # Creation form (mirror CreateChannelDialog)
    ├── ProjectSettings.tsx          # Settings page (mirror ChannelSettings)
    └── ProjectDetails.tsx           # Main project view (new)

src/routes.tsx                   # Add /workspaces/:id/projects routes
```

### Pattern 1: Entity + Membership Table Schema

**What:** Two-table pattern for entities with membership
**When to use:** Any entity requiring access control (projects, channels, documents)
**Example:**

```typescript
// Source: convex/schema.ts (existing patterns)
export default defineSchema({
  projects: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    color: v.string(),  // Tailwind color class or hex
    workspaceId: v.id("workspaces"),
    roleCount: v.object({
      admin: v.number(),
      member: v.number(),
    }),
  })
    .index("by_workspace", ["workspaceId"])
    .searchIndex("by_name", { searchField: "name", filterFields: ["workspaceId"] }),

  projectMembers: defineTable({
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),  // Denormalized for efficient queries
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  })
    .index("by_user", ["userId"])
    .index("by_project", ["projectId"])
    .index("by_project_user", ["projectId", "userId"])
    .index("by_workspace_user", ["workspaceId", "userId"])
    .index("by_project_role", ["projectId", "role"]),
});
```

**Why this works:**
- Efficient bi-directional queries (user→projects, project→users)
- Compound index enables unique constraint checks
- Denormalized workspaceId avoids JOIN for common queries
- roleCount enables quick member statistics without counting

### Pattern 2: Atomic Entity Creation with Membership

**What:** Create entity + initial membership in single mutation
**When to use:** All entity creation that requires access control
**Example:**

```typescript
// Source: convex/channels.ts create mutation (existing pattern)
export const create = mutation({
  args: {
    name: v.string(),
    color: v.string(),
    workspaceId: v.id("workspaces"),
  },
  returns: v.id("projects"),
  handler: async (ctx, { name, color, workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Check workspace admin role
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId))
      .first();

    if (membership?.role !== "admin") {
      throw new ConvexError("Only workspace admins can create projects");
    }

    // Create project
    const projectId = await ctx.db.insert("projects", {
      name,
      color,
      workspaceId,
      roleCount: { admin: 1, member: 0 },
    });

    // Add creator as admin
    await ctx.db.insert("projectMembers", {
      projectId,
      userId,
      workspaceId,
      role: "admin",
    });

    // Auto-create dedicated channel
    const channelId = await ctx.db.insert("channels", {
      name: `${name} Discussion`,
      workspaceId,
      isPublic: false,
      linkedProjectId: projectId,  // Link to project
      roleCount: { admin: 1, member: 0 },
    });

    await ctx.db.insert("channelMembers", {
      channelId,
      userId,
      workspaceId,
      role: "admin",
    });

    return projectId;
  },
});
```

**Why this works:**
- Entire operation is atomic (Convex mutation = transaction)
- Authorization check happens first (fail fast)
- Creator gets immediate access
- No race conditions or partial states

### Pattern 3: Membership-Based Query with getAll

**What:** Fetch entities user has access to via membership join
**When to use:** Listing user-accessible entities
**Example:**

```typescript
// Source: convex/documents.ts listByUserMembership (existing pattern)
export const listByUserMembership = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(projectValidator),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Get user's project memberships
    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId))
      .collect();

    const projectIds = memberships.map(m => m.projectId);

    // Batch fetch projects (avoids N+1)
    const projects = await getAll(ctx.db, projectIds);

    return projects.filter((p): p is NonNullable<typeof p> => p !== null);
  },
});
```

**Why this works:**
- Single index lookup for memberships
- getAll batches project fetches (efficient)
- Type guard ensures type safety
- Scales to hundreds of projects

### Pattern 4: Form Validation with Zod + React Hook Form

**What:** Type-safe form validation with automatic error handling
**When to use:** All forms (creation, editing, settings)
**Example:**

```typescript
// Source: src/pages/App/Channel/CreateChannelDialog.tsx (existing pattern)
const formSchema = z.object({
  name: z.string().min(1, { message: "Project name is required" }),
  color: z.string().min(1, { message: "Color is required" }),
});

export function CreateProjectDialog({ workspaceId, open, onOpenChange }) {
  const createProject = useMutation(api.projects.create);
  const navigate = useNavigate();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      color: "#3b82f6",  // blue-500
    },
  });

  const createNewProject = async (values: z.infer<typeof formSchema>) => {
    try {
      const projectId = await createProject({ ...values, workspaceId });
      toast({
        title: "Project created",
        description: `Successfully created project "${values.name}"`,
      });
      form.reset();
      navigate(`/workspaces/${workspaceId}/projects/${projectId}`);
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error creating project",
        description: error.message || "Please try again later",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(createNewProject)}>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Enter project name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Color picker field */}
            <Button type="submit">Create Project</Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

**Why this works:**
- Type inference from Zod schema
- Automatic error display
- Single source of truth for validation
- Server errors handled gracefully

### Pattern 5: Collapsible Sidebar Group

**What:** Sidebar section with create button and item list
**When to use:** Entity navigation in sidebar
**Example:**

```typescript
// Source: src/pages/App/Channel/ChannelSelectorList.tsx (existing pattern)
export function ProjectSelectorList({ workspaceId, projectId, onProjectSelect }) {
  const [showCreateProject, setShowCreateProject] = useState(false);
  const projects = useQuery(api.projects.listByUserMembership, { workspaceId });

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      <SidebarGroupAction
        title="Create project"
        onClick={() => setShowCreateProject(true)}
      >
        <FolderPlusIcon />
        <span className="sr-only">Create project</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {projects?.map((project) => (
          <ProjectSelectorItem
            key={project._id}
            project={project}
            projectId={projectId}
            onProjectSelect={onProjectSelect}
          />
        ))}
      </SidebarMenu>
      <CreateProjectDialog
        workspaceId={workspaceId}
        open={showCreateProject}
        onOpenChange={setShowCreateProject}
      />
    </SidebarGroup>
  );
}
```

**Why this works:**
- Consistent with existing sidebar sections
- Create dialog triggered from + button
- Real-time updates via Convex useQuery
- Accessibility built-in (sr-only)

### Anti-Patterns to Avoid

- **Separate membership updates:** Never create entity without adding creator membership — must be atomic
- **Client-side auth checks:** Authorization must happen in Convex mutations, not just UI hiding
- **Array-based membership:** Don't store `memberIds: v.array(v.id("users"))` — use join table for scalability
- **Filter without index:** Don't use `.filter()` for membership queries — use `.withIndex()` for performance
- **Forgetting roleCount:** Must maintain roleCount for efficient statistics (used in UI)
- **Missing compound indexes:** Always add `by_entity_user` index for membership checks

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Batch fetching related documents | Loop over IDs calling `ctx.db.get()` | `getAll` from convex-helpers | Optimized batching; avoids N+1 queries |
| Form validation | Custom validation functions | Zod + React Hook Form | Type safety; consistent error handling; already standard |
| Role-based UI hiding | Multiple conditional checks | Reusable `<ProtectedRoute>` or hooks | Centralized logic; easier to audit |
| Cascade deletes | Manual sequential deletes | Convex mutation with Promise.all | Atomic; won't leave orphans on failure |
| Color picker | Custom color input | shadcn/ui color picker patterns | Accessibility; consistent UX; Tailwind integration |
| Sidebar collapsible state | Custom useState | shadcn/ui Collapsible + SidebarGroup | Accessible; animated; persistent state |

**Key insight:** The codebase already has proven patterns for every aspect of projects. Custom solutions would create inconsistency and technical debt.

## Common Pitfalls

### Pitfall 1: Forgetting Authorization in Every Mutation

**What goes wrong:** Mutations that don't check user permissions allow unauthorized access
**Why it happens:** Easy to forget auth checks when focused on business logic
**How to avoid:**
- Start every mutation with `const userId = await getAuthUserId(ctx)`
- Check authorization before any database writes
- Use role checks from membership tables, not client-provided values
**Warning signs:**
- ConvexError about authentication when testing
- Users able to modify entities they shouldn't access

**Example from codebase:**
```typescript
// GOOD - from convex/workspaces.ts
export const update = mutation({
  handler: async (ctx, { id, name }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Check admin role
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", id).eq("userId", userId))
      .first();

    if (membership?.role !== "admin") {
      throw new ConvexError("Not authorized");
    }

    // Now safe to update
    await ctx.db.patch(id, { name });
  },
});
```

### Pitfall 2: Not Using Indexes for Membership Queries

**What goes wrong:** Queries without indexes scan entire tables; slow and expensive
**Why it happens:** Convex allows `.filter()` which seems easier than defining indexes
**How to avoid:**
- Always use `.withIndex()` for queries that could return many results
- Define compound indexes for multi-field lookups (e.g., `by_project_user`)
- Review schema indexes before implementing queries
**Warning signs:**
- Queries taking >100ms
- Convex dashboard showing slow queries
- Backend warnings about missing indexes

**Example:**
```typescript
// BAD - scans entire table
const membership = await ctx.db
  .query("projectMembers")
  .filter(q => q.eq(q.field("projectId"), projectId) &&
               q.eq(q.field("userId"), userId))
  .first();

// GOOD - uses index
const membership = await ctx.db
  .query("projectMembers")
  .withIndex("by_project_user", (q) =>
    q.eq("projectId", projectId).eq("userId", userId))
  .first();
```

### Pitfall 3: Inconsistent roleCount Updates

**What goes wrong:** roleCount diverges from actual member count; UI shows wrong numbers
**Why it happens:** Forgetting to increment/decrement when adding/removing members
**How to avoid:**
- Always update roleCount in same mutation as membership changes
- Use transaction guarantees (mutations are atomic)
- Consider helper functions for add/remove that handle both
**Warning signs:**
- Member count in UI doesn't match actual members
- Negative roleCount values
- roleCount doesn't decrease when removing members

**Example from codebase:**
```typescript
// From convex/channelMembers.ts addToChannel
const channel = await ctx.db.get(channelId);
const { member } = channel.roleCount;

// Add membership
await ctx.db.insert("channelMembers", {
  channelId,
  userId,
  role: "member",
});

// MUST update roleCount atomically
await ctx.db.patch(channelId, {
  roleCount: {
    ...channel.roleCount,
    member: member + 1
  },
});
```

### Pitfall 4: Race Conditions with Auto-Created Channel

**What goes wrong:** Project creation succeeds but channel creation fails; orphaned project
**Why it happens:** Not understanding Convex mutation atomicity
**How to avoid:**
- Keep project + channel creation in SAME mutation
- Convex mutations are transactions — failure rolls back everything
- Don't split across multiple mutations or actions
**Warning signs:**
- Projects exist without associated channels
- Partial failures in creation flow
- Users reporting "channel not found" errors

**Example:**
```typescript
// BAD - split across mutations
export const create = mutation({
  handler: async (ctx, args) => {
    const projectId = await ctx.db.insert("projects", {...});
    // If next mutation fails, project exists without channel!
    await ctx.scheduler.runAfter(0, internal.channels.createProjectChannel, {
      projectId
    });
    return projectId;
  }
});

// GOOD - single atomic mutation
export const create = mutation({
  handler: async (ctx, args) => {
    const projectId = await ctx.db.insert("projects", {...});
    const channelId = await ctx.db.insert("channels", {
      linkedProjectId: projectId,
      ...
    });
    // Both succeed or both fail together
    return projectId;
  }
});
```

### Pitfall 5: Hardcoding "admin" Checks for Project Creation

**What goes wrong:** Copy-paste check for workspace admin role fails silently
**Why it happens:** Not understanding role enums and string literals
**How to avoid:**
- Import WorkspaceRole enum from `@shared/enums/roles`
- Use `WorkspaceRole.ADMIN` constant, not string "admin"
- Enables refactoring and catches typos at compile time
**Warning signs:**
- TypeScript errors about string vs. enum
- Authorization checks that should work but don't
- Magic strings scattered in code

**Example:**
```typescript
// BAD - string literal
if (membership?.role !== "admin") {
  throw new ConvexError("Not authorized");
}

// GOOD - enum constant (from existing codebase)
import { WorkspaceRole } from "@shared/enums/roles";

if (membership?.role !== WorkspaceRole.ADMIN) {
  throw new ConvexError("Not authorized");
}
```

### Pitfall 6: Not Denormalizing workspaceId in projectMembers

**What goes wrong:** Querying "all projects user has access to in workspace X" requires fetching all user's projects then filtering
**Why it happens:** Following strict normalization principles without considering query patterns
**How to avoid:**
- Store workspaceId in projectMembers (matches channelMembers pattern)
- Create compound index `by_workspace_user`
- Accept small storage cost for query performance
**Warning signs:**
- Queries fetching too many records
- Client-side filtering of results
- Slow project list rendering

**Example from existing schema:**
```typescript
// GOOD - from convex/schema.ts channelMembers
channelMembers: defineTable({
  channelId: v.id("channels"),
  workspaceId: v.id("workspaces"),  // Denormalized!
  userId: v.id("users"),
  role: channelRoleSchema,
})
  .index("by_workspace_user", ["workspaceId", "userId"])
```

## Code Examples

Verified patterns from official sources and existing codebase:

### Complete Project Creation Flow

```typescript
// convex/projects.ts
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { WorkspaceRole } from "@shared/enums/roles";

export const create = mutation({
  args: {
    name: v.string(),
    color: v.string(),
    workspaceId: v.id("workspaces"),
  },
  returns: v.id("projects"),
  handler: async (ctx, { name, color, workspaceId }) => {
    // 1. Authentication
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // 2. Authorization - workspace admin only
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId))
      .first();

    if (workspaceMembership?.role !== WorkspaceRole.ADMIN) {
      throw new ConvexError("Only workspace admins can create projects");
    }

    // 3. Create project
    const projectId = await ctx.db.insert("projects", {
      name,
      color,
      workspaceId,
      roleCount: { admin: 1, member: 0 },
    });

    // 4. Add creator as admin
    await ctx.db.insert("projectMembers", {
      projectId,
      userId,
      workspaceId,
      role: "admin",
    });

    // 5. Auto-create dedicated channel (atomic)
    const channelId = await ctx.db.insert("channels", {
      name: `${name} Discussion`,
      workspaceId,
      isPublic: false,
      linkedProjectId: projectId,
      roleCount: { admin: 1, member: 0 },
    });

    await ctx.db.insert("channelMembers", {
      channelId,
      userId,
      workspaceId,
      role: "admin",
    });

    return projectId;
  },
});
```

### Membership Management

```typescript
// convex/projectMembers.ts
export const addToProject = mutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects")
  },
  returns: v.id("projectMembers"),
  handler: async (ctx, { userId, projectId }) => {
    const requestingUserId = await getAuthUserId(ctx);
    if (!requestingUserId) throw new ConvexError("Not authenticated");

    const project = await ctx.db.get(projectId);
    if (!project) throw new ConvexError("Project not found");

    // Check requesting user is project admin
    const requestingMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", projectId).eq("userId", requestingUserId))
      .first();

    if (requestingMembership?.role !== "admin") {
      throw new ConvexError("Only project admins can add members");
    }

    // Check not already member
    const existingMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", projectId).eq("userId", userId))
      .unique();

    if (existingMembership) {
      throw new ConvexError("User is already a project member");
    }

    // Add member to project
    const membershipId = await ctx.db.insert("projectMembers", {
      projectId,
      userId,
      workspaceId: project.workspaceId,
      role: "member",
    });

    // Update roleCount
    await ctx.db.patch(projectId, {
      roleCount: {
        ...project.roleCount,
        member: project.roleCount.member + 1,
      },
    });

    // Add member to linked channel
    if (project.linkedChannelId) {
      await ctx.db.insert("channelMembers", {
        channelId: project.linkedChannelId,
        userId,
        workspaceId: project.workspaceId,
        role: "member",
      });
    }

    return membershipId;
  },
});
```

### Sidebar Integration

```typescript
// src/pages/App/Project/ProjectSelectorList.tsx
import { useQuery } from "convex/react";
import { FolderPlus } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu
} from "../../../components/ui/sidebar";
import { ProjectSelectorItem } from "./ProjectSelectorItem";
import { CreateProjectDialog } from "./CreateProjectDialog";

export function ProjectSelectorList({
  workspaceId,
  projectId,
  onProjectSelect
}) {
  const [showCreateProject, setShowCreateProject] = useState(false);
  const projects = useQuery(api.projects.listByUserMembership, {
    workspaceId
  });

  // Sort alphabetically by name (per requirements)
  const sortedProjects = projects
    ?.slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      <SidebarGroupAction
        title="Create project"
        onClick={() => setShowCreateProject(true)}
      >
        <FolderPlus />
        <span className="sr-only">Create project</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {sortedProjects?.map((project) => (
          <ProjectSelectorItem
            key={project._id}
            project={project}
            projectId={projectId}
            onProjectSelect={onProjectSelect}
          />
        ))}
      </SidebarMenu>
      <CreateProjectDialog
        workspaceId={workspaceId}
        open={showCreateProject}
        onOpenChange={setShowCreateProject}
      />
    </SidebarGroup>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Array of member IDs | Membership join tables | Established pattern in Convex | Scalable queries; bi-directional lookup |
| Client-side RBAC | Server-side authorization in mutations | Best practice 2024+ | Security; can't be bypassed |
| Manual batching | convex-helpers getAll | Available now | Cleaner code; optimized |
| Formik | React Hook Form + Zod | 2023+ standard | Better performance; type safety |
| Custom validation | Zod schema validation | 2024+ standard | Runtime + compile-time safety |
| RGB colors | OKLCH in Tailwind v4 | Tailwind v4 (2024) | Wider gamut; better contrast |

**Deprecated/outdated:**
- **String-based role checks:** Use enum constants (`WorkspaceRole.ADMIN`) not string literals
- **Filter-based queries:** Use `.withIndex()` for membership queries, not `.filter()`
- **Snapshot isolation assumptions:** Convex provides serializability, not snapshot isolation

## Open Questions

Things that couldn't be fully resolved:

1. **Color picker implementation**
   - What we know: shadcn/ui has color picker patterns; Tailwind v4 uses OKLCH
   - What's unclear: Exact component to use (custom vs. library); color storage format (hex vs. Tailwind class vs. OKLCH)
   - Recommendation: Start with simple color selector (6-8 predefined Tailwind colors as classes); store as Tailwind class string (e.g., "bg-blue-500"); allows future enhancement without schema migration

2. **Channel inheritance complexity**
   - What we know: Project creates channel atomically; channel membership should mirror project
   - What's unclear: How to handle member addition to project (must also add to channel); synchronization strategy
   - Recommendation: Add members to both project and channel in same mutation; store `linkedProjectId` in channels table to identify auto-created channels; prevents divergence

3. **Empty state design specifics**
   - What we know: Empty states should explain next action; shadcn/ui supports minimal empty components
   - What's unclear: Exact content and CTAs for project empty state
   - Recommendation: Match channel/document empty states; show create button + brief explanation; consistent UX

4. **Description field location**
   - What we know: Projects can have descriptions (marked as Claude's discretion)
   - What's unclear: Edit inline (like document titles) or in settings page only
   - Recommendation: Settings page only for v1 (simpler); matches channel pattern; inline editing can be added later if needed

## Sources

### Primary (HIGH confidence)
- [Convex Official Documentation - Schemas](https://docs.convex.dev/database/schemas) - Schema definition best practices
- [Convex Official Documentation - OCC and Atomicity](https://docs.convex.dev/database/advanced/occ) - Transaction guarantees and patterns
- [Convex Official Documentation - Best Practices](https://docs.convex.dev/understanding/best-practices/) - Index optimization and query patterns
- [Convex Stack - Relationship Structures](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas) - Membership table patterns
- [Convex Stack - Authorization Best Practices](https://stack.convex.dev/authorization) - RBAC implementation guidance
- Existing codebase patterns (convex/channels.ts, convex/documents.ts, convex/schema.ts) - Proven implementations

### Secondary (MEDIUM confidence)
- [React Hook Form Documentation](https://react-hook-form.com/docs/useform) - Form handling patterns
- [React Hook Form with Zod Guide 2026](https://dev.to/marufrahmanlive/react-hook-form-with-zod-complete-guide-for-2026-1em1) - Integration best practices
- [shadcn/ui Forms Documentation](https://ui.shadcn.com/docs/forms/react-hook-form) - Form components
- [shadcn/ui Sidebar Documentation](https://ui.shadcn.com/docs/components/radix/sidebar) - Sidebar patterns
- [LogRocket - UI Best Practices for Empty States](https://blog.logrocket.com/ui-design-best-practices-loading-error-empty-state-react/) - Empty state design

### Tertiary (LOW confidence - flagged for validation)
- [shadcn Color Picker Implementations](https://shadcnstudio.com/blog/shadcn-color-pickers) - Various community approaches
- [RBAC Implementation Pitfalls](https://idenhaus.com/rbac-implementation-pitfalls/) - General RBAC mistakes (not Convex-specific)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All dependencies already in project; no unknowns
- Architecture patterns: HIGH - Direct patterns from existing codebase (channels, documents, workspaces)
- Don't hand-roll: HIGH - All items verified in existing code or official docs
- Pitfalls: HIGH - Based on common Convex mistakes and codebase patterns
- Code examples: HIGH - Adapted from working codebase patterns

**Research date:** 2026-02-05
**Valid until:** 2026-03-05 (30 days - stable stack, mature patterns)

**Key assumption:** Project patterns should exactly mirror channel/document patterns for consistency. Any deviation requires explicit justification.
