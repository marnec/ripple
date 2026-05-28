import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { auditLog } from "../../auditLog";
import {
  getWorkspaceMembership,
  requireWorkspaceMember,
} from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { hasFeature } from "./entitlements";

/**
 * Shared install-completion logic. Both the public `completeAppInstallation`
 * (auth from session) and the internal `completeInstallationFromCallback`
 * (auth from a consumed install nonce) funnel through here once the actor's
 * admin role on the workspace has been established by the caller.
 *
 * Idempotent on `(workspaceId, externalAccountId)`; gates on the
 * `<provider>_integration` entitlement; inserts the synthetic bot user and
 * writes the `integration.activated` audit-log entry.
 */
async function doCompleteInstall(
  ctx: MutationCtx,
  args: {
    actorId: Id<"users">;
    workspaceId: Id<"workspaces">;
    provider: string;
    externalAccountId: string;
    externalAccountType?: "organization" | "user";
    accountLogin?: string;
    externalBotLogin?: string;
    credentialToken?: string;
    oauthRefreshToken?: string;
    oauthExpiresAt?: number;
  },
): Promise<Id<"workspaceIntegrations">> {
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
    // Re-running the OAuth flow refreshes the stored credentials (the user just
    // re-consented), without re-inserting the bot user or re-firing the audit
    // log. PAT re-paste hits the same path. Other display fields (login, type)
    // are also refreshed in case they changed (e.g. username rename).
    if (
      args.credentialToken !== undefined ||
      args.oauthRefreshToken !== undefined
    ) {
      await ctx.db.patch(existing._id, {
        credentialToken: args.credentialToken ?? existing.credentialToken,
        oauthRefreshToken:
          args.oauthRefreshToken ?? existing.oauthRefreshToken,
        oauthExpiresAt: args.oauthExpiresAt ?? existing.oauthExpiresAt,
        accountLogin: args.accountLogin ?? existing.accountLogin,
        externalAccountType:
          args.externalAccountType ?? existing.externalAccountType,
        externalBotLogin:
          args.externalBotLogin ?? existing.externalBotLogin,
      });
    }
    return existing._id;
  }

  const featureKey = `${args.provider}_integration`;
  const enabled = await hasFeature(ctx, args.workspaceId, featureKey);
  if (!enabled) {
    throw new ConvexError(
      `Workspace does not have the ${featureKey} feature enabled`,
    );
  }

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
    externalBotLogin: args.externalBotLogin,
    credentialToken: args.credentialToken,
    oauthRefreshToken: args.oauthRefreshToken,
    oauthExpiresAt: args.oauthExpiresAt,
    installedBy: args.actorId,
  });

  try {
    await auditLog.log(ctx, {
      action: "integration.activated",
      actorId: args.actorId.toString(),
      resourceType: "workspaces",
      resourceId: args.workspaceId,
      severity: "info",
      metadata: { provider: args.provider, accountLogin: args.accountLogin },
      scope: args.workspaceId,
    });
  } catch (err) {
    console.error("[auditLog] failed to log integration.activated", err);
  }

  return integrationId;
}

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
    externalBotLogin: v.optional(v.string()),
    credentialToken: v.optional(v.string()),
  },
  returns: v.id("workspaceIntegrations"),
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceMember(ctx, args.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });
    return doCompleteInstall(ctx, { ...args, actorId: userId });
  },
});

/**
 * Install-completion entry point for the `/integrations/github/setup` HTTP
 * callback. The callback has no auth session — the actor is resolved from
 * the one-time install nonce (`installFlow.consumeInstallState`). We
 * re-verify that the resolved user is still a workspace admin before
 * trusting it, then funnel through the same `doCompleteInstall` helper.
 */
export const completeInstallationFromCallback = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    provider: v.string(),
    externalAccountId: v.string(),
    externalAccountType: v.optional(
      v.union(v.literal("organization"), v.literal("user")),
    ),
    accountLogin: v.optional(v.string()),
    externalBotLogin: v.optional(v.string()),
    credentialToken: v.optional(v.string()),
    oauthRefreshToken: v.optional(v.string()),
    oauthExpiresAt: v.optional(v.number()),
  },
  returns: v.id("workspaceIntegrations"),
  handler: async (ctx, args) => {
    const membership = await getWorkspaceMembership(
      ctx,
      args.workspaceId,
      args.userId,
    );
    if (membership?.role !== WorkspaceRole.ADMIN) {
      throw new ConvexError(
        "Install callback actor is not a workspace admin",
      );
    }
    return doCompleteInstall(ctx, {
      actorId: args.userId,
      workspaceId: args.workspaceId,
      provider: args.provider,
      externalAccountId: args.externalAccountId,
      externalAccountType: args.externalAccountType,
      accountLogin: args.accountLogin,
      externalBotLogin: args.externalBotLogin,
      credentialToken: args.credentialToken,
      oauthRefreshToken: args.oauthRefreshToken,
      oauthExpiresAt: args.oauthExpiresAt,
    });
  },
});

/**
 * Admin-gated access check for the wizard's GitHub-facing actions. Verifies
 * the caller is a workspace admin and that the installation belongs to the
 * workspace, returning the `externalAccountId` the action needs to mint a
 * token. Internal — invoked via `ctx.runQuery` from the wizard actions,
 * which propagate the caller's identity.
 */
export const assertWizardInstallation = query({
  args: {
    workspaceId: v.id("workspaces"),
    externalAccountId: v.string(),
  },
  returns: v.object({ externalAccountId: v.string() }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });
    const integration = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_externalAccount", (q) =>
        q.eq("externalAccountId", args.externalAccountId),
      )
      .unique();
    if (!integration || integration.workspaceId !== args.workspaceId) {
      throw new ConvexError("Installation not found in this workspace");
    }
    return { externalAccountId: integration.externalAccountId };
  },
});

/**
 * List the workspace's provider installations for the workspace-settings
 * Integrations tab and the activation wizard's account picker. Member-gated
 * read; admin-only actions check role at their own boundary.
 *
 * `installedBy` resolves to the installer's display name where available so
 * the UI can render "installed by …" without a second round-trip.
 */
export const listInstallations = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(
    v.object({
      _id: v.id("workspaceIntegrations"),
      provider: v.string(),
      externalAccountId: v.string(),
      externalAccountType: v.optional(
        v.union(v.literal("organization"), v.literal("user")),
      ),
      accountLogin: v.optional(v.string()),
      installedBy: v.optional(v.id("users")),
      installedByName: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    return Promise.all(
      rows.map(async (r) => {
        const installer = r.installedBy
          ? await ctx.db.get(r.installedBy)
          : null;
        return {
          _id: r._id,
          provider: r.provider,
          externalAccountId: r.externalAccountId,
          externalAccountType: r.externalAccountType,
          accountLogin: r.accountLogin,
          installedBy: r.installedBy,
          installedByName: installer?.name,
        };
      }),
    );
  },
});
