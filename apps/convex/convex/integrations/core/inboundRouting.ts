import type { MutationCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { effectiveLinkStatus } from "./entitlements";

/**
 * Shared inbound routing for a repo-scoped GitHub delivery.
 *
 * Both inbound paths — the issue/comment mutation (`github/webhook`) and the
 * pull-request action (`github/pullRequestWebhook`) — must resolve the same
 * thing from the stable installation + repo ids the payload carries: the live,
 * sync-active project link the event targets. This helper is the single home
 * for that `resolve integration → resolve link → workspace-match → freeze-gate
 * → record receipt → silent-rename` dance, so the two paths can't drift (they
 * previously had: one used `.unique()` and would throw on a historical
 * disconnected link, the other recorded `lastWebhookAt` while the other
 * didn't).
 *
 * Returns `null` for every "delivered but irrelevant" case (unknown
 * installation, unknown/disconnected repo, workspace mismatch, frozen/paused
 * link) so callers drop cleanly without tripping the receiver's retry/DLQ.
 * On success the returned link already reflects any silent rename.
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
  // Resolve workspace via installation id.
  const integration = await ctx.db
    .query("workspaceIntegrations")
    .withIndex("by_externalAccount", (q) =>
      q.eq("externalAccountId", args.externalAccountId),
    )
    .unique();
  if (!integration) return null; // unknown installation — drop silently

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
  if (!link || link.workspaceId !== integration.workspaceId) return null;

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
