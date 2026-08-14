import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import { internal } from "./_generated/api";
import { mutation } from "./functions";
import { WorkspaceRole } from "@ripple/shared/enums";
import { logActivity } from "./auditLog";
import { getUserDisplayName } from "@ripple/shared/displayName";
import { cascadeDelete } from "./cascadeDelete";
import { projectValidator } from "./validators";
import { requireWorkspaceMember, requireCreatorOrWorkspaceAdmin, requireResourceMember, checkWorkspaceMember, checkResourceMember } from "./authHelpers";
import { searchResourcesByFavorite } from "./resourceSearch";
import { notify } from "./utils/notify";

export const create = mutation({
  args: {
    name: v.string(),
    color: v.string(),
    workspaceId: v.id("workspaces"),
    key: v.optional(v.string()),
  },
  returns: v.id("projects"),
  handler: async (ctx, { name, color, workspaceId, key: providedKey }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId, { role: WorkspaceRole.ADMIN });

    // Use provided key or auto-generate from name
    const baseKey = (providedKey
      ? providedKey.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 5)
      : name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase()
    ) || "PRJ";

    let key = baseKey;
    let suffix = 1;
    while (true) {
      const existing = await ctx.db
        .query("projects")
        .withIndex("by_workspace_key", (q) =>
          q.eq("workspaceId", workspaceId).eq("key", key)
        )
        .first();
      if (!existing) break;
      key = `${baseKey}${suffix}`;
      suffix++;
    }

    // Create the project
    const projectId = await ctx.db.insert("projects", {
      name,
      color,
      workspaceId,
      creatorId: userId,
      key,
      taskCounter: 0,
    });

    // Seed default task statuses for this project. Triage sits leftmost
    // as the inbox for externally-ingested issues (GitHub etc.); it lets
    // an admin activate the integration immediately without manual setup.
    // `isTriage` and `isDefault` are mutually exclusive — Todo stays the
    // destination for user-created tasks.
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: false,
      isCompleted: false,
      isTriage: true,
      setsStartDate: false,
    });

    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 1,
      isDefault: true,
      isCompleted: false,
      setsStartDate: false,
    });

    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "In Progress",
      color: "bg-blue-500",
      order: 2,
      isDefault: false,
      isCompleted: false,
      setsStartDate: true,
    });

    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Done",
      color: "bg-green-500",
      order: 3,
      isDefault: false,
      isCompleted: true,
      setsStartDate: false,
    });

    await logActivity(ctx, {
      userId, resourceType: "projects", resourceId: projectId,
      action: "created", newValue: name, resourceName: name, scope: workspaceId,
    });

    const user = await ctx.db.get(userId);
    await notify(ctx, {
      category: "projectCreated",
      userId,
      userName: getUserDisplayName(user),
      scope: workspaceId,
      title: `${getUserDisplayName(user)} created a project`,
      body: name,
      url: `/workspaces/${workspaceId}/projects/${projectId}`,
    });

    return projectId;
  },
});

export const search = query({
  args: {
    workspaceId: v.id("workspaces"),
    searchText: v.optional(v.string()),
    isFavorite: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(projectValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())),
  }),
  handler: async (ctx, { workspaceId, searchText, isFavorite, paginationOpts }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    if (searchText?.trim()) {
      return await ctx.db
        .query("projects")
        .withSearchIndex("by_name", (q) =>
          q.search("name", searchText).eq("workspaceId", workspaceId),
        )
        .paginate(paginationOpts);
    }

    if (isFavorite === true) {
      return await searchResourcesByFavorite(ctx, {
        workspaceId,
        userId,
        resourceType: "project",
        paginationOpts,
      });
    }

    return await ctx.db
      .query("projects")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .paginate(paginationOpts);
  },
});

export const get = query({
  args: { id: v.id("projects") },
  returns: v.union(projectValidator, v.null()),
  handler: async (ctx, { id }) => {
    const result = await checkResourceMember(ctx, "projects", id);
    if (!result) return null;
    return result.resource;
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(projectValidator),
  handler: async (ctx, { workspaceId }) => {
    const auth = await checkWorkspaceMember(ctx, workspaceId);
    if (!auth) return [];

    // Return all projects in workspace (for admin views)
    return await ctx.db
      .query("projects")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    key: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, description, color, key }) => {
    // The workspace rule first, the creator narrowing second — in that order.
    // Reversed, a creator who has been removed from the workspace still learns
    // the project exists (and, before this, could still rename it).
    const { userId, resource: project, membership } = await requireResourceMember(
      ctx,
      "projects",
      id,
    );
    requireCreatorOrWorkspaceAdmin(project, userId, membership);

    // Build patch object with only provided fields
    const patch: { name?: string; description?: string; color?: string; key?: string } = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (color !== undefined) patch.color = color;

    // Validate and set project key
    if (key !== undefined) {
      const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      if (normalized.length < 2 || normalized.length > 5) {
        throw new ConvexError("Project key must be 2-5 alphanumeric characters");
      }
      // Check uniqueness within workspace
      const existing = await ctx.db
        .query("projects")
        .withIndex("by_workspace_key", (q) =>
          q.eq("workspaceId", project.workspaceId).eq("key", normalized)
        )
        .first();
      if (existing && existing._id !== id) {
        throw new ConvexError("Project key already in use");
      }
      patch.key = normalized;
    }

    if (Object.keys(patch).length > 0) {
      if (name !== undefined && name !== project.name) {
        await logActivity(ctx, {
          userId, resourceType: "projects", resourceId: id,
          action: "renamed", oldValue: project.name, newValue: name, resourceName: name, scope: project.workspaceId,
        });
      }
      await ctx.db.patch(id, patch);
    }

    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    // Same order as `update`, and the stakes are higher here: this path
    // cascade-deletes every task, status, cycle and comment under the project.
    const { userId, resource: project, membership } = await requireResourceMember(
      ctx,
      "projects",
      id,
    );
    requireCreatorOrWorkspaceAdmin(project, userId, membership);

    await logActivity(ctx, {
      userId, resourceType: "projects", resourceId: id,
      action: "deleted", oldValue: project.name, resourceName: project.name, scope: project.workspaceId,
    });

    const user = await ctx.db.get(userId);
    await notify(ctx, {
      category: "projectDeleted",
      userId,
      userName: getUserDisplayName(user),
      scope: project.workspaceId,
      title: `${getUserDisplayName(user)} deleted a project`,
      body: project.name,
      url: `/workspaces/${project.workspaceId}`,
    });

    // Batched, like every other unbounded parent (channels, workspaces). A
    // project's task fanout has no ceiling — task imports accept a ~900KB CSV
    // per job — and each task recurses into ten more tables, so the inline
    // single-transaction cascade put a large project past the write cap: the
    // mutation aborted and the same abort recurred on every retry, leaving the
    // project permanently undeletable. Note the collection pass still walks the
    // whole subtree read-only in this transaction; only the writes are batched.
    await cascadeDelete.deleteWithCascadeBatched(ctx, "projects", id, {
      batchHandlerRef: internal.cascadeDelete._cascadeBatchHandler,
      onComplete: internal.cascadeDelete._batchCascadeOnComplete,
      onCompleteContext: {
        userId, resourceType: "projects", resourceId: id, scope: project.workspaceId,
      },
    });

    return null;
  },
});
