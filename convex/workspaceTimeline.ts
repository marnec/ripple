import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { getUserDisplayName } from "@shared/displayName";
import { auditLog } from "./auditLog";

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
});

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.optional(v.number()),
  },
  returns: v.array(timelineItemValidator),
  handler: async (ctx, { workspaceId, limit: rawLimit }) => {
    const limit = Math.min(rawLimit ?? 20, 50);
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Verify workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Fetch recent audit entries scoped to this workspace
    const entries: AuditEntry[] = await auditLog.queryByScope(ctx, {
      scope: workspaceId,
      limit,
    });

    // Collect unique actor IDs and batch-fetch user docs
    const actorIds = [
      ...new Set(
        entries
          .map((e) => e.actorId)
          .filter((id): id is string => id !== undefined),
      ),
    ];
    const userDocs = await Promise.all(
      actorIds.map(async (id) => {
        const normalized = ctx.db.normalizeId("users", id);
        return normalized ? ctx.db.get(normalized) : null;
      }),
    );
    const userMap = new Map<string, { name: string; image?: string }>();
    for (let i = 0; i < actorIds.length; i++) {
      const doc = userDocs[i];
      userMap.set(actorIds[i], {
        name: doc ? getUserDisplayName(doc) : "Unknown",
        image: doc?.image ?? undefined,
      });
    }

    type MetadataShape = { resourceName?: string; oldValue?: string; newValue?: string };

    return entries.map((entry) => {
      const actor = entry.actorId
        ? userMap.get(entry.actorId)
        : undefined;
      const meta = (entry.metadata ?? {}) as MetadataShape;
      return {
        _id: entry._id,
        timestamp: entry.timestamp,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceName: meta.resourceName,
        actorName: actor?.name ?? "System",
        actorImage: actor?.image,
        oldValue: meta.oldValue,
        newValue: meta.newValue,
      };
    });
  },
});
