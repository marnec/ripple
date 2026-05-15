import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { auditLog } from "../../auditLog";
import { requireWorkspaceMember } from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";

/**
 * Admin-only workspace feature toggle. Single chokepoint for entitlement
 * writes; the future billing flow flips the same rows with a non-"manual"
 * source, leaving this UI affordance unchanged.
 *
 * On a value flip, `fanoutPauseByBilling` is called so every link in the
 * workspace reflects the new entitlement state synchronously.
 */
export const setWorkspaceFeature = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    featureKey: v.string(),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceMember(ctx, args.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    const existing = await ctx.db
      .query("workspaceEntitlements")
      .withIndex("by_workspace_feature", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("featureKey", args.featureKey),
      )
      .unique();

    // "Was it enabled?" — a missing row counts as disabled. Drives whether
    // we need to fan out the entitlement state to every link.
    const wasEnabled = existing?.enabled === true;

    if (existing) {
      await ctx.db.patch(existing._id, { enabled: args.enabled });
    } else {
      await ctx.db.insert("workspaceEntitlements", {
        workspaceId: args.workspaceId,
        featureKey: args.featureKey,
        enabled: args.enabled,
        source: "manual",
      });
    }

    // Only fan out and log when the effective value changes. `pausedByBilling`
    // mirrors entitlement-off, so flipping enable→true means paused→false.
    if (wasEnabled !== args.enabled) {
      await fanoutPauseByBilling(ctx, args.workspaceId, !args.enabled);
      const action = args.enabled
        ? "integration.entitlement.granted"
        : "integration.entitlement.revoked";
      try {
        await auditLog.log(ctx, {
          action,
          actorId: userId.toString(),
          resourceType: "workspaces",
          resourceId: args.workspaceId,
          severity: "info",
          metadata: { featureKey: args.featureKey },
          scope: args.workspaceId,
        });
      } catch (err) {
        console.error(`[auditLog] failed to log ${action}`, err);
      }
    }

    return null;
  },
});

/**
 * Display/dispatch status for a repo↔project link. Folds the `status` state
 * machine and the orthogonal `pausedByBilling` entitlement flag into one
 * value. Precedence: `disconnected` > `frozen` (billing) > `paused` /
 * `configuring` / `active`.
 *
 * Only `"active"` represents a sync-active link — every other return value
 * means inbound and outbound sync are halted.
 */
export type EffectiveLinkStatus =
  | "configuring"
  | "active"
  | "paused"
  | "frozen"
  | "disconnected";

export function effectiveLinkStatus(
  link: Pick<Doc<"projectIntegrationLinks">, "status" | "pausedByBilling">,
): EffectiveLinkStatus {
  if (link.status === "disconnected") return "disconnected";
  if (link.pausedByBilling) return "frozen";
  return link.status;
}

/**
 * Single chokepoint for capability checks. Returns true iff the workspace
 * has a `workspaceEntitlements` row for `featureKey` with `enabled=true`.
 *
 * Tested in tests/integrations.entitlements.test.ts.
 */
/**
 * Walks every `projectIntegrationLinks` row in the workspace and sets
 * `pausedByBilling = paused`. Called by the entitlement-toggle mutation when
 * a feature flag flips; the inverse is run when entitlement is restored.
 *
 * Disconnected links are flipped too — they're terminal for display purposes
 * (see `effectiveLinkStatus`), but the flag stays accurate so a reconnect
 * doesn't inherit a stale `pausedByBilling` value.
 */
export async function fanoutPauseByBilling(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  paused: boolean,
): Promise<void> {
  const links = await ctx.db
    .query("projectIntegrationLinks")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  for (const link of links) {
    if (link.pausedByBilling === paused) continue;
    await ctx.db.patch(link._id, { pausedByBilling: paused });
  }
}

export async function hasFeature(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  featureKey: string,
): Promise<boolean> {
  const row = await ctx.db
    .query("workspaceEntitlements")
    .withIndex("by_workspace_feature", (q) =>
      q.eq("workspaceId", workspaceId).eq("featureKey", featureKey),
    )
    .unique();
  return row?.enabled === true;
}
