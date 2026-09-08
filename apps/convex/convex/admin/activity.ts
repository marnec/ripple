import { v } from "convex/values";
import { getUserDisplayName } from "@ripple/shared/displayName";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { auditLog } from "../auditLog";
import { requirePlatformAdmin } from "../authHelpers";

/**
 * The operator's view of the audit trail — sliced by workspace (`list`) or by
 * person (`listByUser`).
 *
 * Same rows the product's `workspaceTimeline.list` renders, read through
 * `requirePlatformAdmin` instead of `requireWorkspaceMember`, because the
 * operator is generally not a member of the tenant they are investigating. It
 * also carries what the product feed deliberately hides: severity, the raw
 * `resourceType.verb`, the resource id, whether an integration (rather than a
 * person) made the change, and the actor's id/email so a row can lead to the
 * user page.
 *
 * Both slices are one indexed range scan — `by_scope_timestamp` and
 * `by_actor_timestamp` respectively — so neither is the expensive one.
 *
 * Paging grows the window rather than passing a cursor: the audit component
 * exposes `queryByScope`/`queryByActor` with a *lower* time bound only, so
 * there is no way to ask for "the 50 before this one". `search()` takes a
 * cursor but drops `filters.scope` on the floor (it is accepted and never
 * applied), which would leak every workspace's activity into this page, so it
 * is not an option. Re-reading a growing prefix is affordable at console
 * volumes and honest about its ceiling: `MAX_WINDOW` caps it, and `hasMore`
 * says whether the tail was reached.
 */
const DEFAULT_WINDOW = 50;
const MAX_WINDOW = 500;

type AuditEntry = {
  _id: string;
  timestamp: number;
  action: string;
  severity: "info" | "warning" | "error" | "critical";
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  scope?: string;
  metadata?: unknown;
};

/** System actors write audit entries without a `users` row behind them. */
const SYSTEM_ACTOR_NAMES: Record<string, string> = {
  "system:garbage-collector": "Garbage Collector",
};

const activityEntryValidator = v.object({
  _id: v.string(),
  timestamp: v.number(),
  action: v.string(),
  severity: v.union(
    v.literal("info"),
    v.literal("warning"),
    v.literal("error"),
    v.literal("critical"),
  ),
  resourceType: v.optional(v.string()),
  resourceId: v.optional(v.string()),
  resourceName: v.optional(v.string()),
  oldValue: v.optional(v.string()),
  newValue: v.optional(v.string()),
  /** `"integration"` when an external provider drove the change. */
  source: v.optional(v.string()),
  /** Absent for entries logged without an actor. */
  actorId: v.optional(v.string()),
  actorName: v.string(),
  actorEmail: v.optional(v.string()),
  actorImage: v.optional(v.string()),
  /** True only when `actorId` resolves to a real `users` row the console can link to. */
  actorIsUser: v.boolean(),
  /** JSON-serialized `Record<tableName, count>`, cascade deletes only. */
  cascadeSummary: v.optional(v.string()),
  /**
   * The tenant the event belongs to — the audit row's `scope`. Only the
   * per-user feed sets these: the per-workspace feed is one tenant by
   * construction and its header already names it. `workspaceId` is absent when
   * the entry carries no scope; `workspaceName` is additionally absent once the
   * workspace row itself is gone, since the trail outlives it.
   */
  workspaceId: v.optional(v.id("workspaces")),
  workspaceName: v.optional(v.string()),
});

type Actor = { name: string; email?: string; image?: string; isUser: boolean };

/**
 * Batch the actor lookups: a page of activity is usually a handful of people,
 * and the same person over and over.
 */
async function resolveActors(ctx: QueryCtx, entries: AuditEntry[]) {
  const actorIds = [
    ...new Set(
      entries.map((e) => e.actorId).filter((id): id is string => id !== undefined),
    ),
  ];
  const actorDocs = await Promise.all(
    actorIds.map(async (id) => {
      if (id.startsWith("system:")) return null;
      const normalized = ctx.db.normalizeId("users", id);
      return normalized ? await ctx.db.get(normalized) : null;
    }),
  );

  const actors = new Map<string, Actor>();
  actorIds.forEach((id, i) => {
    const doc = actorDocs[i] as Doc<"users"> | null;
    if (id.startsWith("system:")) {
      actors.set(id, { name: SYSTEM_ACTOR_NAMES[id] ?? "System", isUser: false });
    } else if (doc) {
      actors.set(id, {
        name: getUserDisplayName(doc),
        email: doc.email,
        image: doc.image,
        isUser: true,
      });
    } else {
      // A deleted account, or an id from before this scope existed. Say so
      // rather than rendering a link that leads to a 'not found' page.
      actors.set(id, { name: "Deleted user", isUser: false });
    }
  });
  return actors;
}

/**
 * Names for the tenants a page of a *user's* activity spans. Same batching
 * argument as the actors: a person's feed is usually a couple of workspaces,
 * repeated. Scopes that no longer resolve are simply absent from the map — the
 * row still renders, just without a tenant label.
 */
async function resolveWorkspaces(ctx: QueryCtx, entries: AuditEntry[]) {
  const scopes = [
    ...new Set(entries.map((e) => e.scope).filter((s): s is string => s !== undefined)),
  ];
  const workspaces = new Map<string, { id: Id<"workspaces">; name?: string }>();
  await Promise.all(
    scopes.map(async (scope) => {
      const normalized = ctx.db.normalizeId("workspaces", scope);
      if (!normalized) return;
      const doc = await ctx.db.get(normalized);
      workspaces.set(scope, { id: normalized, name: doc?.name });
    }),
  );
  return workspaces;
}

type MetadataShape = {
  resourceName?: string;
  /** `admin/workspaces.remove` logs the workspace name under `name`. */
  name?: string;
  oldValue?: string;
  newValue?: string;
  source?: string;
};

function toEntry(
  entry: AuditEntry,
  actors: Map<string, Actor>,
  workspaces?: Map<string, { id: Id<"workspaces">; name?: string }>,
) {
  const isCascade = entry.action.endsWith(".cascade_deleted");
  // A cascade's metadata is a per-table count map, not the usual shape.
  const meta = (isCascade ? {} : (entry.metadata ?? {})) as MetadataShape;
  const actor = entry.actorId ? actors.get(entry.actorId) : undefined;
  const workspace = entry.scope ? workspaces?.get(entry.scope) : undefined;
  return {
    _id: entry._id,
    timestamp: entry.timestamp,
    action: entry.action,
    severity: entry.severity,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    resourceName: meta.resourceName ?? meta.name,
    oldValue: meta.oldValue,
    newValue: meta.newValue,
    source: meta.source,
    actorId: actor?.isUser ? entry.actorId : undefined,
    actorName: actor?.name ?? "System",
    actorEmail: actor?.email,
    actorImage: actor?.image,
    actorIsUser: actor?.isUser ?? false,
    cascadeSummary: isCascade ? JSON.stringify(entry.metadata) : undefined,
    workspaceId: workspace?.id,
    workspaceName: workspace?.name,
  };
}

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.optional(v.number()),
    /** Indexed server-side filter (`by_scope_resourceType_timestamp`), not a post-filter. */
    resourceTypes: v.optional(v.array(v.string())),
  },
  returns: v.object({
    /** Null once the workspace itself is gone — its audit trail outlives it. */
    workspaceName: v.union(v.string(), v.null()),
    entries: v.array(activityEntryValidator),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { workspaceId, limit: rawLimit, resourceTypes }) => {
    await requirePlatformAdmin(ctx);

    const limit = Math.max(1, Math.min(rawLimit ?? DEFAULT_WINDOW, MAX_WINDOW));

    const workspace = await ctx.db.get(workspaceId);

    // One extra row is the whole "Load more" signal — the component returns a
    // bare array, so there is nothing else to read a tail marker off.
    const fetched: AuditEntry[] = await auditLog.queryByScope(ctx, {
      scope: workspaceId,
      limit: limit + 1,
      resourceTypes:
        resourceTypes && resourceTypes.length > 0 ? resourceTypes : undefined,
    });

    const hasMore = fetched.length > limit;
    const entries = hasMore ? fetched.slice(0, limit) : fetched;
    const actors = await resolveActors(ctx, entries);

    return {
      workspaceName: workspace?.name ?? null,
      hasMore,
      // No workspace map: every row is this page's workspace, which the header
      // already names.
      entries: entries.map((entry) => toEntry(entry, actors)),
    };
  },
});

/**
 * One person's audit trail across every tenant they touch — the user page's
 * counterpart to `list`.
 *
 * `actorId` is written as the raw `users` id at every log site, so this is
 * `by_actor_timestamp` with no normalization and nothing to backfill. Narrowing
 * by workspace and/or resource type is indexed too (`by_actor_scope_timestamp`,
 * `by_actor_resourceType_timestamp`); the component applies each as a stream
 * rather than a post-`take` filter, which is what keeps the `limit + 1`
 * over-fetch a truthful tail signal under a filter.
 */
export const listByUser = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
    /** Narrow to one tenant. Indexed (`by_actor_scope_timestamp`). */
    workspaceId: v.optional(v.id("workspaces")),
    /** Indexed server-side filter (`by_actor_resourceType_timestamp`). */
    resourceTypes: v.optional(v.array(v.string())),
  },
  returns: v.object({
    entries: v.array(activityEntryValidator),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { userId, limit: rawLimit, workspaceId, resourceTypes }) => {
    await requirePlatformAdmin(ctx);

    const limit = Math.max(1, Math.min(rawLimit ?? DEFAULT_WINDOW, MAX_WINDOW));

    const fetched: AuditEntry[] = await auditLog.queryByActor(ctx, {
      actorId: userId,
      limit: limit + 1,
      scope: workspaceId,
      resourceTypes:
        resourceTypes && resourceTypes.length > 0 ? resourceTypes : undefined,
    });

    const hasMore = fetched.length > limit;
    const entries = hasMore ? fetched.slice(0, limit) : fetched;
    const [actors, workspaces] = await Promise.all([
      resolveActors(ctx, entries),
      resolveWorkspaces(ctx, entries),
    ]);

    return {
      hasMore,
      entries: entries.map((entry) => toEntry(entry, actors, workspaces)),
    };
  },
});
