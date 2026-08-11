import type { MutationCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { effectiveLinkStatus } from "./entitlements";

/**
 * Shared inbound routing for a repo-scoped webhook delivery.
 *
 * Every inbound path — GitHub's issue/comment mutation, GitHub's pull-request
 * action, GitLab's issue/note/MR mutation — must resolve the same thing from the
 * stable ids the payload carries: the live, sync-active project link the event
 * targets. This module is the single home for that `resolve link → authorize →
 * freeze-gate → record receipt → silent-rename` dance, so the paths can't drift.
 * They previously had: one used `.unique()` and would throw on a historical
 * disconnected link, another recorded `lastWebhookAt` while the other didn't,
 * and GitLab (which forked a local copy of this) silently dropped the rename
 * branch, so a renamed GitLab project showed its old path forever.
 *
 * Authorization is the one genuinely provider-shaped step, so it's the seam:
 *  - GitHub authenticates centrally (the receiver verifies one App-wide HMAC)
 *    and authorizes here by matching the link's workspace against the
 *    installation the delivery came from.
 *  - GitLab has no App: the secret is per-link, so authentication itself can
 *    only happen once the link is resolved — verify-after-resolve rather than
 *    GitHub's resolve-after-verify.
 * Both reduce to one question — "given this link, may this delivery act?" —
 * which is why the ordering difference costs a callback, not a second copy.
 *
 * Returns `null` for every "delivered but irrelevant" case (unknown/disconnected
 * repo, failed authorization, frozen/paused link) so callers drop cleanly
 * without tripping the receiver's retry/DLQ. On success the returned link
 * already reflects any silent rename.
 */
export async function resolveInboundLink(
  ctx: MutationCtx,
  args: {
    /** Stable provider-side repo id — GitHub node id / GitLab project id. */
    externalRepoId: string;
    /** The delivery's current repo path — drives the silent rename. */
    repoFullName?: string;
    /**
     * Provider-specific authorization for this delivery, given the resolved
     * link. Return false to drop silently.
     */
    authorize: (
      link: Doc<"projectIntegrationLinks">,
    ) => boolean | Promise<boolean>;
  },
): Promise<Doc<"projectIntegrationLinks"> | null> {
  // Resolve link via stable repo id (survives renames). A repo may have
  // several rows here — disconnected historical links coexist with the live
  // one (createLink only forbids *live* duplicates), so pick the single
  // non-disconnected link rather than assuming uniqueness.
  const repoLinks = await ctx.db
    .query("projectIntegrationLinks")
    .withIndex("by_externalRepo", (q) =>
      q.eq("externalRepoId", args.externalRepoId),
    )
    .collect();
  const link = repoLinks.find((l) => l.status !== "disconnected") ?? null;
  if (!link) return null; // unknown/disconnected repo — drop silently

  if (!(await args.authorize(link))) return null;

  // Freeze gate.
  if (effectiveLinkStatus(link) !== "active") return null;

  // Record receipt for the "Last webhook received" indicator (only sync-active
  // links reach here — matching the indicator's "are we still receiving live
  // events?" intent) and, if the repo was renamed, refresh the human-readable
  // label in the same patch. The stable `externalRepoId` keeps the link intact.
  const renamed =
    !!args.repoFullName && args.repoFullName !== link.externalRepoFullName;
  await ctx.db.patch(link._id, {
    lastWebhookAt: Date.now(),
    ...(renamed ? { externalRepoFullName: args.repoFullName } : {}),
  });

  return renamed
    ? { ...link, externalRepoFullName: args.repoFullName! }
    : link;
}

/**
 * GitHub's binding of `resolveInboundLink`: authorize by matching the link's
 * workspace against the App installation the delivery names. Authentication
 * already happened centrally (the receiver verified the App-wide HMAC), so the
 * installation id is trusted input here — what's left is proving it owns this
 * repo's link rather than another workspace's.
 */
export async function resolveActiveInboundLink(
  ctx: MutationCtx,
  args: {
    externalAccountId: string;
    externalRepoId: string;
    /** `repository.full_name` from the payload — drives the silent rename. */
    repoFullName?: string;
  },
): Promise<Doc<"projectIntegrationLinks"> | null> {
  return resolveInboundLink(ctx, {
    externalRepoId: args.externalRepoId,
    repoFullName: args.repoFullName,
    authorize: async (link) => {
      const integration = await ctx.db
        .query("workspaceIntegrations")
        .withIndex("by_externalAccount", (q) =>
          q.eq("externalAccountId", args.externalAccountId),
        )
        .unique();
      // Unknown installation, or it belongs to a different workspace than the
      // link resolved from the repo id — drop.
      return !!integration && link.workspaceId === integration.workspaceId;
    },
  });
}
