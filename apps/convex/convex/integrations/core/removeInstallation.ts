import { ConvexError, v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { githubClientFromEnv } from "../github/client";
import { gitlabOAuthFromEnv, revokeToken } from "../gitlab/oauthClient";

/**
 * Remove a provider installation from a workspace — the counterpart to the
 * install wizard, and the thing whose absence left the Installations list
 * read-only with no way back out.
 *
 * "Remove" means the same on both sides of the wire, not just locally:
 *  - GitHub: `DELETE /app/installations/{id}` genuinely uninstalls the App
 *    from the account. Dropping only our row would leave it installed there,
 *    still delivering webhooks we no longer have a reason to accept.
 *  - GitLab: there is no install-level entity, so the stored OAuth token is
 *    revoked instead — the equivalent loss of capability.
 *
 * Three steps, in this order for reasons that matter:
 *  1. `beginRemoveInstallation` — authorize, disconnect every linked repo
 *     through the existing cascade (which freezes each task's history), and
 *     hand back what the provider call needs.
 *  2. this action — call the provider. Best-effort: a provider outage must not
 *     strand a workspace with an integration it cannot remove, so a failure is
 *     logged and step 3 proceeds.
 *  3. `finishRemoveInstallation` — delete the row, once the cascade has
 *     drained. Deleting earlier would mislabel in-flight freeze snapshots.
 *
 * An action rather than a mutation because steps 2 needs the network; the
 * database work is done by the two internal mutations either side of it.
 */
export const remove = action({
  args: {
    workspaceId: v.id("workspaces"),
    integrationId: v.id("workspaceIntegrations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actorId = await getAuthUserId(ctx);
    if (!actorId) throw new ConvexError("Not authenticated");

    const { provider, externalAccountId, credentialToken, drainJobIds } =
      await ctx.runMutation(
        internal.integrations.core.install.beginRemoveInstallation,
        {
          workspaceId: args.workspaceId,
          integrationId: args.integrationId,
          actorId,
        },
      );

    try {
      if (provider === "github") {
        const client = githubClientFromEnv();
        if (client) {
          const ok = await client.uninstallApp(externalAccountId);
          if (!ok) {
            console.error(
              `[removeInstallation] GitHub refused to uninstall ${externalAccountId}`,
            );
          }
        } else {
          console.error(
            "[removeInstallation] GitHub App credentials not configured — removing locally only",
          );
        }
      } else if (provider === "gitlab" && credentialToken) {
        const cfg = gitlabOAuthFromEnv();
        if (cfg) {
          const ok = await revokeToken({ cfg, token: credentialToken });
          if (!ok) {
            console.error("[removeInstallation] GitLab token revoke failed");
          }
        } else {
          console.error(
            "[removeInstallation] GitLab OAuth client not configured — removing locally only",
          );
        }
      }
    } catch (err) {
      // Deliberately swallowed: the local removal is the part we control, and
      // leaving a half-removed integration behind is worse than an App that
      // outlives its Ripple row (which the user can still remove on the
      // provider). The error is logged for the operator.
      console.error("[removeInstallation] provider call threw", err);
    }

    // `drainJobIds` rides along so the waiter can tell a cascade that has
    // stopped from one the scheduler simply hasn't started — see
    // `finishRemoveInstallation`.
    await ctx.runMutation(
      internal.integrations.core.install.finishRemoveInstallation,
      { integrationId: args.integrationId, drainJobIds },
    );

    return null;
  },
});
