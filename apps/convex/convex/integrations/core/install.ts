import { ConvexError, v } from "convex/values";
import { query, type MutationCtx } from "../../_generated/server";
import { internalMutation, mutation } from "../../functions";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { auditLog } from "../../auditLog";
import { insertJobFailure } from "../../backgroundJobFailures";
import {
  getWorkspaceMembership,
  requireWorkspaceMember,
} from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { getAuthUserId } from "@convex-dev/auth/server";
import { hasFeature } from "./entitlements";

/**
 * Providers whose `externalAccountId` is *caller-supplied* rather than derived
 * from a credential we just verified, and which therefore need an explicit
 * possession proof before the account can be claimed.
 *
 * GitHub qualifies: the App install id arrives on the setup callback's query
 * string, ids are small sequential integers, and the App JWT mints a working
 * installation token for *any* installation of our App — so an unproven claim
 * is a cross-tenant read of someone else's private repos. The proof is
 * `GET /user/installations` on a user-to-server token (see
 * `github/setupAction.finalizeInstall`).
 *
 * GitLab is deliberately absent: its `externalAccountId` is the numeric user id
 * read from `/user` on a token it has just exchanged, so possession is
 * structural — there is no caller-supplied id to forge.
 */
const PROVIDERS_REQUIRING_INSTALL_PROOF = new Set(["github"]);

/**
 * Shared install-completion logic. Both the public `completeAppInstallation`
 * (auth from session) and the internal `completeInstallationFromCallback`
 * (auth from a consumed install nonce) funnel through here once the actor's
 * admin role on the workspace has been established by the caller.
 *
 * Admin-on-your-own-workspace is NOT sufficient authority to claim an external
 * account — anyone can create a workspace and be its admin. Hence the
 * `installationVerified` gate below, which the client-callable mutation has no
 * way to set. Keep the check here rather than in either caller: this function
 * is the single write path, and a gate on one door is a gate on none.
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
    /**
     * Set only by flows that have proven the actor can see this external
     * account on the provider. Never plumbed from client-supplied args.
     */
    installationVerified?: boolean;
  },
): Promise<Id<"workspaceIntegrations">> {
  // Fail closed, and before any read or write: an unproven claim must not even
  // reach the idempotent-reclaim branch below, or a second call could refresh
  // credentials on a row the caller was never entitled to.
  if (
    PROVIDERS_REQUIRING_INSTALL_PROOF.has(args.provider) &&
    !args.installationVerified
  ) {
    throw new ConvexError(
      `A ${args.provider} installation can only be claimed through the install callback, which verifies the installation belongs to you`,
    );
  }

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
    // Set by `github/setupAction.finalizeInstall` once `GET /user/installations`
    // has confirmed the installing user can see this installation. Internal
    // mutation, so this cannot be supplied by a client.
    installationVerified: v.optional(v.boolean()),
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
      installationVerified: args.installationVerified,
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
    /**
     * The provider the calling action speaks. Required by every caller that
     * goes on to mint a provider credential: a workspace can hold a GitHub and
     * a GitLab account at once, so "belongs to this workspace" does not imply
     * "is a GitHub install", and this query is the last gate before an id
     * becomes an App-token request.
     */
    provider: v.optional(v.string()),
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
    if (
      !integration ||
      integration.workspaceId !== args.workspaceId ||
      (args.provider !== undefined && integration.provider !== args.provider)
    ) {
      throw new ConvexError("Installation not found in this workspace");
    }
    return { externalAccountId: integration.externalAccountId };
  },
});

/** How long a user has to pick from the accounts they just authorized. */
const INSTALL_CANDIDATE_TTL_MS = 15 * 60 * 1000;

const candidateValidator = v.object({
  externalAccountId: v.string(),
  accountLogin: v.optional(v.string()),
  accountType: v.optional(
    v.union(v.literal("organization"), v.literal("user")),
  ),
});

/**
 * Park the accounts a user just proved they can reach, so they can pick one.
 * Internal — the only writer is a flow holding a user-to-server token, which is
 * what makes this list a possession proof rather than caller input.
 */
export const storeInstallCandidates = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    provider: v.string(),
    candidates: v.array(candidateValidator),
    externalBotLogin: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const token = crypto.randomUUID();
    await ctx.db.insert("integrationInstallCandidates", {
      token,
      workspaceId: args.workspaceId,
      userId: args.userId,
      provider: args.provider,
      candidates: args.candidates,
      externalBotLogin: args.externalBotLogin,
      expiresAt: Date.now() + INSTALL_CANDIDATE_TTL_MS,
    });
    return token;
  },
});

/**
 * Read back a parked candidate list for the picker. Scoped to the user who
 * authorized: the list is derived from *their* provider account, so it is not
 * another admin's to see, even in the same workspace. Returns null for an
 * unknown, expired, or someone else's token rather than throwing — the UI just
 * doesn't open a picker.
 */
export const listInstallCandidates = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      workspaceId: v.id("workspaces"),
      provider: v.string(),
      candidates: v.array(candidateValidator),
      alreadyConnected: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("integrationInstallCandidates")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!row || row.expiresAt < Date.now()) return null;

    const membership = await getWorkspaceMembership(
      ctx,
      row.workspaceId,
      row.userId,
    );
    if (membership?.role !== WorkspaceRole.ADMIN) return null;

    const viewerId = await getAuthUserId(ctx);
    if (viewerId !== row.userId) return null;

    // So the picker can mark accounts this workspace already holds instead of
    // letting the user pick one that will bounce off the uniqueness check.
    const existing = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", row.workspaceId))
      .collect();

    return {
      workspaceId: row.workspaceId,
      provider: row.provider,
      candidates: row.candidates,
      alreadyConnected: existing.map((e) => e.externalAccountId),
    };
  },
});

/**
 * Connect one of the accounts from a parked candidate list.
 *
 * This is the second door into `doCompleteInstall` that may set
 * `installationVerified` — and it earns it the same way the setup callback
 * does, by only accepting an `externalAccountId` that appears in a list built
 * from the user's own provider token. Caller-supplied ids that are not on the
 * list are refused, so this cannot be used to claim a stranger's installation.
 */
export const claimInstallation = mutation({
  args: {
    token: v.string(),
    externalAccountId: v.string(),
  },
  returns: v.id("workspaceIntegrations"),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("integrationInstallCandidates")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!row) throw new ConvexError("This connection request has expired");

    // One-time use, valid or not.
    await ctx.db.delete(row._id);
    if (row.expiresAt < Date.now()) {
      throw new ConvexError("This connection request has expired");
    }

    const { userId } = await requireWorkspaceMember(ctx, row.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });
    if (userId !== row.userId) {
      throw new ConvexError(
        "This connection request belongs to a different user",
      );
    }

    const chosen = row.candidates.find(
      (c) => c.externalAccountId === args.externalAccountId,
    );
    if (!chosen) {
      throw new ConvexError("That account was not part of this authorization");
    }

    return doCompleteInstall(ctx, {
      actorId: userId,
      workspaceId: row.workspaceId,
      provider: row.provider,
      externalAccountId: chosen.externalAccountId,
      externalAccountType: chosen.accountType,
      accountLogin: chosen.accountLogin,
      externalBotLogin: row.externalBotLogin,
      // Earned above: the account came off a list only the user's own token
      // could have produced.
      installationVerified: true,
    });
  },
});

/**
 * Step 1 of removing an installation: authorize it, and start the disconnect
 * cascade for every repo linked through it.
 *
 * The integration row is deliberately NOT deleted here. `drainDisconnectBatch`
 * resolves the provider from this row to stamp `tasks.externalRefFrozen`, and
 * `resolveProvider(null)` falls back to `"github"` — so deleting it while the
 * cascade is still draining would silently mislabel every frozen ref on a
 * GitLab removal. `finishRemoveInstallation` deletes it once the drains are
 * done.
 *
 * Returns what the action needs to call the provider, so the action never has
 * to read the row itself.
 */
export const beginRemoveInstallation = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    integrationId: v.id("workspaceIntegrations"),
    actorId: v.id("users"),
  },
  returns: v.object({
    provider: v.string(),
    externalAccountId: v.string(),
    credentialToken: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const membership = await getWorkspaceMembership(
      ctx,
      args.workspaceId,
      args.actorId,
    );
    if (membership?.role !== WorkspaceRole.ADMIN) {
      throw new ConvexError("Only workspace admins can remove an installation");
    }

    const integration = await ctx.db.get(args.integrationId);
    if (!integration || integration.workspaceId !== args.workspaceId) {
      throw new ConvexError("Installation not found in this workspace");
    }

    // Every repo linked through this account, including ones already
    // disconnected (harmless — the drain is idempotent).
    const links = await ctx.db
      .query("projectIntegrationLinks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const own = links.filter(
      (l) => l.workspaceIntegrationId === args.integrationId,
    );

    for (const link of own) {
      if (link.status !== "disconnected") {
        await ctx.db.patch(link._id, { status: "disconnected" });
      }
      await ctx.scheduler.runAfter(
        0,
        internal.integrations.core.links.drainDisconnectBatch,
        { projectIntegrationLinkId: link._id },
      );
    }

    try {
      await auditLog.log(ctx, {
        action: "integration.removed",
        actorId: args.actorId.toString(),
        resourceType: "workspaces",
        resourceId: args.workspaceId,
        severity: "warning",
        metadata: {
          provider: integration.provider,
          externalAccountId: integration.externalAccountId,
          accountLogin: integration.accountLogin ?? "",
          linksDisconnected: own.length,
        },
        scope: args.workspaceId,
      });
    } catch (err) {
      console.error("[auditLog] failed to log integration.removed", err);
    }

    return {
      provider: integration.provider,
      externalAccountId: integration.externalAccountId,
      credentialToken: integration.credentialToken,
    };
  },
});

/**
 * Consecutive polls that may see the cascade in the same place before the wait
 * gives up. Counted on *stalls*, not on elapsed time: a healthy cascade of any
 * size moves its frontier every batch, so this can only be reached by a drain
 * that has genuinely stopped — which is the point, because a wall-clock cap
 * would abandon a legitimately huge disconnect and strand its installation.
 */
const MAX_STALLED_POLLS = 8;

/**
 * Backoff between polls, indexed by how long the cascade has been stalled: a
 * moving cascade is re-checked in a second, a stuck one backs off to a minute.
 * Reaching the cap therefore means roughly three minutes of complete standstill,
 * not three minutes of work.
 */
function pollDelayMs(stalledPolls: number): number {
  return Math.min(1000 * 2 ** stalledPolls, 60_000);
}

/**
 * Step 3: delete the integration row, but only once the disconnect cascade has
 * drained — see `beginRemoveInstallation` for why the ordering matters.
 * Re-schedules itself while any `taskIntegrationLinks` row under this account
 * survives.
 *
 * The wait is bounded, and bounded on *progress* rather than on attempts.
 * `drainDisconnectBatch` is a scheduled mutation, so a deterministic failure
 * inside it (a transaction cap while freezing a task with many comment links,
 * a validation throw) is terminal and those rows never disappear — against
 * which an unbounded waiter is an endless chain of scheduled mutations for the
 * life of the deployment. `frontier` is the first surviving task-link row seen
 * last time; the cascade deletes in index order, so a frontier that has not
 * moved means the drain has not run. Only those polls count toward the cap.
 *
 * On giving up the integration row is deliberately left in place, and the
 * stall is reported to `backgroundJobFailures` instead. Deleting it would be
 * worse than the strand it looks like: the cascade never froze those tasks,
 * and `resolveProvider(null)` mislabels every one of them once the row it
 * resolves through is gone.
 *
 * The synthetic bot user is left in place on purpose: it authored comments and
 * may be `creatorId` on imported tasks, and deleting it would dangle those.
 */
export const finishRemoveInstallation = internalMutation({
  args: {
    integrationId: v.id("workspaceIntegrations"),
    /** Consecutive polls that found the cascade exactly where they left it. */
    stalledPolls: v.optional(v.number()),
    /** The first surviving task-link row at the previous poll. */
    frontier: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) return null; // already gone — idempotent

    const links = await ctx.db
      .query("projectIntegrationLinks")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", integration.workspaceId),
      )
      .collect();
    const own = links.filter(
      (l) => l.workspaceIntegrationId === args.integrationId,
    );

    let frontier: string | null = null;
    for (const link of own) {
      const remaining = await ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_link_externalIssueId", (q) =>
          q.eq("projectIntegrationLinkId", link._id),
        )
        .first();
      if (remaining) {
        frontier = remaining._id;
        break;
      }
    }

    if (frontier === null) {
      await ctx.db.delete(args.integrationId);
      return null;
    }

    const stalledPolls =
      frontier === args.frontier ? (args.stalledPolls ?? 0) + 1 : 0;

    if (stalledPolls >= MAX_STALLED_POLLS) {
      await insertJobFailure(ctx, {
        kind: "integrations.install:finishRemoveInstallation",
        key: args.integrationId,
        error:
          `Disconnect cascade stalled for workspace ${integration.workspaceId}: ` +
          `taskIntegrationLinks rows under this installation stopped draining. ` +
          `The installation row is left in place so the frozen refs it resolves ` +
          `are not mislabelled; re-run the disconnect once the cause is fixed.`,
      });
      return null;
    }

    await ctx.scheduler.runAfter(
      pollDelayMs(stalledPolls),
      internal.integrations.core.install.finishRemoveInstallation,
      { integrationId: args.integrationId, stalledPolls, frontier },
    );
    return null;
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
  args: {
    workspaceId: v.id("workspaces"),
    /**
     * Restrict to one provider. Omit for the workspace-settings audit list,
     * which deliberately shows every account; pass it from any provider's
     * connect flow, where offering another provider's account is at best a
     * confusing duplicate (two `marnec (user)` rows) and at worst sends a
     * GitLab account id to a GitHub-token-minting action.
     */
    provider: v.optional(v.string()),
  },
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
    const all = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const rows = args.provider
      ? all.filter((r) => r.provider === args.provider)
      : all;
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
