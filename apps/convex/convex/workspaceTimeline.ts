import { v } from "convex/values";
import { query } from "./_generated/server";
import { getUserDisplayName } from "@ripple/shared/displayName";
import { auditLog } from "./auditLog";
import { requireWorkspaceMember } from "./authHelpers";

type AuditEntry = {
  _id: string;
  timestamp: number;
  action: string;
  actorId?: string;
  resourceType?: string;
  metadata?: unknown;
};

const timelineItemValidator = v.object({
  _id: v.string(),
  timestamp: v.number(),
  action: v.string(),
  resourceType: v.optional(v.string()),
  resourceName: v.optional(v.string()),
  actorName: v.string(),
  actorImage: v.optional(v.string()),
  oldValue: v.optional(v.string()),
  newValue: v.optional(v.string()),
  cascadeSummary: v.optional(v.string()), // JSON-serialized Record<tableName, count> for cascade deletes
});

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.optional(v.number()),
    resourceTypes: v.optional(v.array(v.string())),
  },
  returns: v.array(timelineItemValidator),
  handler: async (ctx, { workspaceId, limit: rawLimit, resourceTypes }) => {
    const limit = Math.min(rawLimit ?? 20, 50);
    await requireWorkspaceMember(ctx, workspaceId);

    // Fetch recent audit entries scoped to this workspace
    // When resourceTypes is provided, the audit log over-fetches and filters server-side
    const entries: AuditEntry[] = await auditLog.queryByScope(ctx, {
      scope: workspaceId,
      limit,
      resourceTypes: resourceTypes && resourceTypes.length > 0 ? resourceTypes : undefined,
    });

    // Collect unique actor IDs and batch-fetch user docs
    const actorIds = [
      ...new Set(
        entries
          .map((e) => e.actorId)
          .filter((id): id is string => id !== undefined),
      ),
    ];
    // Resolve system actors (e.g. "system:garbage-collector") without DB lookup
    const SYSTEM_ACTOR_NAMES: Record<string, string> = {
      "system:garbage-collector": "Garbage Collector",
    };

    const userDocs = await Promise.all(
      actorIds.map(async (id) => {
        if (id.startsWith("system:")) return null;
        const normalized = ctx.db.normalizeId("users", id);
        return normalized ? ctx.db.get(normalized) : null;
      }),
    );
    const userMap = new Map<string, { name: string; image?: string }>();
    for (let i = 0; i < actorIds.length; i++) {
      const id = actorIds[i];
      if (id.startsWith("system:")) {
        userMap.set(id, {
          name: SYSTEM_ACTOR_NAMES[id] ?? "System",
          image: undefined,
        });
      } else {
        const doc = userDocs[i];
        userMap.set(id, {
          name: doc ? getUserDisplayName(doc) : "Unknown",
          image: doc?.image ?? undefined,
        });
      }
    }

    type MetadataShape = { resourceName?: string; oldValue?: string; newValue?: string };

    return entries.map((entry) => {
      const actor = entry.actorId
        ? userMap.get(entry.actorId)
        : undefined;
      const isCascade = entry.action.endsWith(".cascade_deleted");
      const meta = (entry.metadata ?? {}) as MetadataShape;
      return {
        _id: entry._id,
        timestamp: entry.timestamp,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceName: isCascade ? undefined : meta.resourceName,
        actorName: actor?.name ?? "System",
        actorImage: actor?.image,
        oldValue: meta.oldValue,
        newValue: meta.newValue,
        cascadeSummary: isCascade ? JSON.stringify(entry.metadata) : undefined,
      };
    });
  },
});
