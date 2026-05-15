import { ConvexError, v } from "convex/values";
import { mutation } from "../../_generated/server";
import { auditLog } from "../../auditLog";
import { requireWorkspaceMember } from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { hasFeature } from "./entitlements";

/**
 * Wizard install-completion entry point. Called after the user finishes
 * the GitHub App install flow (or the equivalent for any other provider)
 * with the provider-supplied account/install identifier.
 *
 * Provider-agnostic — `provider` is an arg so the same mutation handles
 * future GitLab installs without a new shape. (For v1, frontend only ever
 * calls it with `provider: "github"`.)
 *
 * Preconditions:
 *  - Caller is a workspace admin.
 *  - Workspace has the `<provider>_integration` feature enabled.
 *  - `externalAccountId` is not already claimed by a different workspace
 *    (GitHub allows at most one installation per (app, account) pair).
 *
 * On success: inserts a `workspaceIntegrations` row + one synthetic bot
 * `users` row (with `isBot=true`) and writes an `integration.activated`
 * audit-log entry. Idempotent: re-running with the same
 * `(workspaceId, externalAccountId)` returns the existing row.
 */
export const completeAppInstallation = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    provider: v.string(),
    externalAccountId: v.string(),
    externalAccountType: v.optional(
      v.union(v.literal("organization"), v.literal("user")),
    ),
    accountLogin: v.optional(v.string()),
  },
  returns: v.id("workspaceIntegrations"),
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceMember(ctx, args.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    // Idempotency: an installation row may already exist for this
    // (workspaceId, externalAccountId) pair — return it unchanged.
    const existing = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_externalAccount", (q) =>
        q.eq("externalAccountId", args.externalAccountId),
      )
      .unique();
    if (existing) {
      if (existing.workspaceId !== args.workspaceId) {
        throw new ConvexError(
          `External account ${args.externalAccountId} is already claimed by another workspace`,
        );
      }
      return existing._id;
    }

    // Entitlement gate. v1 manually toggled; future billing flows still
    // gate via the same hasFeature chokepoint.
    const featureKey = `${args.provider}_integration`;
    const enabled = await hasFeature(ctx, args.workspaceId, featureKey);
    if (!enabled) {
      throw new ConvexError(
        `Workspace does not have the ${featureKey} feature enabled`,
      );
    }

    // Synthetic bot user — attributing externally-authored tasks/comments.
    // Filtered out of member pickers / facepiles via users.isBot.
    const botUserId = await ctx.db.insert("users", {
      name: args.accountLogin
        ? `${args.provider} (${args.accountLogin})`
        : args.provider,
      isBot: true,
    });

    const integrationId = await ctx.db.insert("workspaceIntegrations", {
      workspaceId: args.workspaceId,
      botUserId,
      provider: args.provider,
      externalAccountId: args.externalAccountId,
      externalAccountType: args.externalAccountType,
      accountLogin: args.accountLogin,
    });

    try {
      await auditLog.log(ctx, {
        action: "integration.activated",
        actorId: userId.toString(),
        resourceType: "workspaces",
        resourceId: args.workspaceId,
        severity: "info",
        metadata: {
          provider: args.provider,
          accountLogin: args.accountLogin,
        },
        scope: args.workspaceId,
      });
    } catch (err) {
      console.error("[auditLog] failed to log integration.activated", err);
    }

    return integrationId;
  },
});
