"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { githubClientFromEnv } from "./client";
import {
  exchangeUserCode,
  githubAppOAuthFromEnv,
  listUserInstallations,
} from "./oauthClient";

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
  args: {
    /**
     * Present on a fresh install. Absent when the user merely authorized (the
     * "connect an existing installation" path), which is what makes the
     * candidate-picker branch below reachable.
     */
    installationId: v.optional(v.string()),
    nonce: v.string(),
    /**
     * GitHub's user-authorization code, present only when the App has "Request
     * user authorization (OAuth) during installation" enabled. Optional in the
     * validator because the query string is not ours to guarantee — but a
     * callback without it cannot prove anything, so it is refused below.
     */
    code: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      workspaceId: v.id("workspaces"),
      /** Set when the browser should open the account picker instead. */
      candidateToken: v.optional(v.string()),
      returnTo: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const resolved = await ctx.runMutation(
      internal.integrations.core.installFlow.consumeInstallState,
      { nonce: args.nonce },
    );
    if (!resolved) return null;

    // Fail closed. The nonce proves this flow began in *a* workspace the actor
    // administers; it says nothing about the installation id GitHub echoed
    // back, which is caller-controlled and enumerable. Without a user token we
    // cannot tell "the org that just installed us" from "an org that installed
    // us last week and hasn't connected yet", so we refuse rather than guess.
    if (!args.code) {
      console.error(
        "[setup] install callback carried no ?code — is 'Request user authorization (OAuth) during installation' enabled on the GitHub App?",
      );
      return null;
    }

    // ── Possession proof ────────────────────────────────────────────────
    // Trade the code for a user-to-server token and ask GitHub which
    // installations that user can see. Anything short of a hit on the claimed
    // id — unconfigured credentials, a failed exchange, an API error — is
    // refused: "we could not check" must never read as "the check passed".
    const oauthCfg = githubAppOAuthFromEnv();
    if (!oauthCfg) {
      console.error(
        "[setup] GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET not configured — cannot verify installation ownership",
      );
      return null;
    }

    let visible: Awaited<ReturnType<typeof listUserInstallations>>;
    try {
      const accessToken = await exchangeUserCode({
        cfg: oauthCfg,
        code: args.code,
      });
      visible = await listUserInstallations({ cfg: oauthCfg, accessToken });
    } catch (err) {
      console.error("[setup] could not verify installation ownership", err);
      return null;
    }

    const slugForBot = process.env.GITHUB_APP_SLUG;

    // No `installation_id` means this was a plain user authorization rather
    // than a fresh install — the "connect an installation that already exists"
    // path. Park what they can see and let them choose; the list itself is the
    // possession proof, so the claim needs no further GitHub call.
    if (!args.installationId) {
      if (visible.length === 0) {
        console.error(
          "[setup] authorized user has no installations of this App to connect",
        );
        return null;
      }
      const candidateToken = await ctx.runMutation(
        internal.integrations.core.install.storeInstallCandidates,
        {
          workspaceId: resolved.workspaceId,
          userId: resolved.userId,
          provider: "github",
          candidates: visible,
          externalBotLogin: slugForBot ? `${slugForBot}[bot]` : undefined,
        },
      );
      return {
        workspaceId: resolved.workspaceId,
        candidateToken,
        returnTo: resolved.returnTo,
      };
    }

    const visibleInstallationIds = visible.map((i) => i.externalAccountId);
    if (!visibleInstallationIds.includes(args.installationId)) {
      // The user authenticated fine — they just have no access to the
      // installation they asked us to bind. This is the attack the check exists
      // for, so it is logged as such.
      console.error(
        `[setup] refusing install: authenticated user cannot see installation ${args.installationId}`,
      );
      return null;
    }

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

    // GitHub App deliveries authored by our own install carry `<slug>[bot]`
    // as the author login. Record it so the inbound echo guard can suppress
    // outbound bounce-backs without a provider-specific env lookup at read time.
    const slug = process.env.GITHUB_APP_SLUG;
    const externalBotLogin = slug ? `${slug}[bot]` : undefined;

    // `doCompleteInstall` throws on three ordinary conditions — entitlement
    // off, the account already claimed by another workspace, the actor no
    // longer an admin. This is a browser navigation, so a throw here is a raw
    // 500 in the user's face; every other failure mode in this action is
    // `console.error` + `return null` (which the route turns into the
    // documented `?github_install=error` redirect), and so is this one.
    try {
      await ctx.runMutation(
        internal.integrations.core.install.completeInstallationFromCallback,
        {
          workspaceId: resolved.workspaceId,
          userId: resolved.userId,
          provider: "github",
          externalAccountId: args.installationId,
          externalAccountType: accountType,
          accountLogin,
          externalBotLogin,
          // Set only here, only after the check above.
          installationVerified: true,
        },
      );
    } catch (err) {
      console.error("[setup] could not complete the installation", err);
      return null;
    }

    return { workspaceId: resolved.workspaceId };
  },
});
