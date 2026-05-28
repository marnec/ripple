import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { auditLog } from "../../auditLog";
import { requireWorkspaceMember } from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { getIntegrationForLink } from "./integrationLookups";

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
      await fanoutPauseByBilling(ctx, args.workspaceId, !args.enabled, {
        provider: providerOfFeatureKey(args.featureKey),
      });
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
 * Walks `projectIntegrationLinks` rows in the workspace and sets
 * `pausedByBilling = paused`. Called by the entitlement-toggle mutation when
 * a feature flag flips; the inverse is run when entitlement is restored.
 *
 * Scoped by `provider` when provided: toggling `gitlab_integration` must NOT
 * fan out onto `github`-provider links (and vice versa). Without the filter,
 * disabling one provider's capability would freeze the other provider's links
 * in the same workspace. When `provider` is omitted (legacy callers + tests
 * that don't care), every link is touched.
 *
 * Disconnected links are flipped too — they're terminal for display purposes
 * (see `effectiveLinkStatus`), but the flag stays accurate so a reconnect
 * doesn't inherit a stale `pausedByBilling` value.
 */
export async function fanoutPauseByBilling(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  paused: boolean,
  opts: { provider?: string } = {},
): Promise<void> {
  const links = await ctx.db
    .query("projectIntegrationLinks")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  for (const link of links) {
    if (link.pausedByBilling === paused) continue;
    if (opts.provider) {
      const integration = await getIntegrationForLink(ctx, link);
      // Legacy links written before `workspaceIntegrationId` (single-install
      // era, github-only) leave the FK absent and `getIntegrationForLink`'s
      // workspace-wide fallback can come up empty. Default those to "github"
      // — matches the convention in `getLinkWebhookConfig`/`drainDisconnect`.
      const provider = integration?.provider ?? "github";
      if (provider !== opts.provider) continue;
    }
    await ctx.db.patch(link._id, {
      pausedByBilling: paused,
      frozenAt: paused ? Date.now() : undefined,
    });
  }
}

/**
 * Map a workspace-feature key (`github_integration`, `gitlab_integration`, …)
 * to the provider string those links carry on `workspaceIntegrations.provider`.
 * Returns `undefined` for keys that aren't provider-scoped, so the fan-out
 * falls back to its workspace-wide behavior.
 */
function providerOfFeatureKey(featureKey: string): string | undefined {
  const m = /^([a-z0-9]+)_integration$/.exec(featureKey);
  return m ? m[1] : undefined;
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

/**
 * Read the current entitlement state for a workspace feature. Member-gated
 * (not admin-gated) so non-admins can render the "ask an admin" hint — the
 * write side (`setWorkspaceFeature`) stays admin-only. Drives the
 * workspace-settings capability toggle.
 */
export const getWorkspaceFeature = query({
  args: { workspaceId: v.id("workspaces"), featureKey: v.string() },
  returns: v.object({ enabled: v.boolean() }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return { enabled: await hasFeature(ctx, args.workspaceId, args.featureKey) };
  },
});

/**
 * Resolve a provider installation id to its workspace's freeze state.
 * Used by the inbound webhook HTTP route to drop frozen deliveries before
 * the receiver component writes its dedup row — so GitHub's own retry
 * machinery keeps re-delivering until the entitlement is restored.
 *
 * Unknown installations resolve to `false` (not frozen) — the webhook
 * adapter still drops them later, but there's nothing to gain from
 * suppressing dedup for unknown installs.
 */
export const isInstallationFrozen = query({
  args: { installationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_externalAccount", (q) =>
        q.eq("externalAccountId", args.installationId),
      )
      .unique();
    if (!integration) return false;
    return !(await hasFeature(
      ctx,
      integration.workspaceId,
      "github_integration",
    ));
  },
});
