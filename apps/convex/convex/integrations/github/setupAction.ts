"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { githubClientFromEnv } from "./client";

/**
 * Finalize a GitHub App install from the `/integrations/github/setup`
 * callback. Resolves the one-time install nonce → workspace + actor, fetches
 * the installation's account metadata (login + org/user) using an App JWT,
 * then writes the `workspaceIntegrations` row via the internal callback
 * mutation.
 *
 * Returns the workspaceId on success (so the HTTP route can redirect to that
 * workspace's settings) or null on any failure (bad/expired nonce, missing
 * creds, GitHub error) so the route can redirect with an error flag.
 */
export const finalizeInstall = internalAction({
  args: { installationId: v.string(), nonce: v.string() },
  returns: v.union(v.null(), v.object({ workspaceId: v.id("workspaces") })),
  handler: async (ctx, args) => {
    const resolved = await ctx.runMutation(
      internal.integrations.core.installFlow.consumeInstallState,
      { nonce: args.nonce },
    );
    if (!resolved) return null;

    const client = githubClientFromEnv();
    if (!client) {
      console.error("[setup] GitHub App credentials not configured");
      return null;
    }

    // Account metadata is best-effort: a failed lookup still completes the
    // install (the row is keyed on installationId, which we already have).
    let accountLogin: string | undefined;
    let accountType: "organization" | "user" | undefined;
    try {
      const account = await client.fetchInstallationAccount(args.installationId);
      if (account) {
        accountLogin = account.login;
        accountType = account.type;
      }
    } catch (err) {
      console.warn("[setup] installation account lookup failed", err);
    }

    await ctx.runMutation(
      internal.integrations.core.install.completeInstallationFromCallback,
      {
        workspaceId: resolved.workspaceId,
        userId: resolved.userId,
        provider: "github",
        externalAccountId: args.installationId,
        externalAccountType: accountType,
        accountLogin,
      },
    );

    return { workspaceId: resolved.workspaceId };
  },
});
