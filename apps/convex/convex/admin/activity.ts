import { v } from "convex/values";
import { getUserDisplayName } from "@ripple/shared/displayName";
import { query } from "../_generated/server";
import { auditLog } from "../auditLog";
import { requirePlatformAdmin } from "../authHelpers";

/**
 * The operator's view of one workspace's audit trail.
 *
 * Same rows the product's `workspaceTimeline.list` renders — one audit-log
 * scope, one workspace — read through `requirePlatformAdmin` instead of
 * `requireWorkspaceMember`, because the operator is generally not a member of
 * the tenant they are investigating. It also carries what the product feed
 * deliberately hides: severity, the raw `resourceType.verb`, the resource id,
 * whether an integration (rather than a person) made the change, and the
 * actor's id/email so a row can lead to the user page.
 *
 * Paging grows the window rather than passing a cursor: the audit component
 * exposes `queryByScope(scope, limit, fromTimestamp)` — a *lower* time bound
 * only — so there is no way to ask for "the 50 before this one". `search()`
 * takes a cursor but drops `filters.scope` on the floor (it is accepted and
 * never applied), which would leak every workspace's activity into this page,
 * so it is not an option. Re-reading a growing prefix is affordable at console
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
});

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

    // Batch the actor lookups: a page of activity is usually a handful of
    // people, and the same person over and over.
    const actorIds = [
      ...new Set(
        entries
          .map((e) => e.actorId)
          .filter((id): id is string => id !== undefined),
      ),
    ];
    const actorDocs = await Promise.all(
      actorIds.map(async (id) => {
        if (id.startsWith("system:")) return null;
        const normalized = ctx.db.normalizeId("users", id);
        return normalized ? await ctx.db.get(normalized) : null;
      }),
    );
    const actors = new Map<
      string,
      { name: string; email?: string; image?: string; isUser: boolean }
    >();
    actorIds.forEach((id, i) => {
      const doc = actorDocs[i];
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

    type MetadataShape = {
      resourceName?: string;
      /** `admin/workspaces.remove` logs the workspace name under `name`. */
      name?: string;
      oldValue?: string;
      newValue?: string;
      source?: string;
    };

    return {
      workspaceName: workspace?.name ?? null,
      hasMore,
      entries: entries.map((entry) => {
        const isCascade = entry.action.endsWith(".cascade_deleted");
        // A cascade's metadata is a per-table count map, not the usual shape.
        const meta = (isCascade ? {} : (entry.metadata ?? {})) as MetadataShape;
        const actor = entry.actorId ? actors.get(entry.actorId) : undefined;
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
        };
      }),
    };
  },
});
