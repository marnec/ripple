/**
 * Where a force resync goes when it gives up.
 *
 * Force resync is a user-initiated recovery button whose whole purpose is
 * convergence after drift, and it is the *least* self-announcing job in the
 * codebase: `links.forceResync` writes the `integration.force_resync` audit
 * entry and returns success the moment the drain is scheduled, so the admin is
 * told it happened before anything has been fetched. The drain is then a bare
 * at-most-once scheduled action — no retrier, no job row, no per-link error
 * field — so a throw left the resync abandoned at an arbitrary offset with the
 * product still reporting success. The admin's next move was to press the
 * button again and get the same silent half-run.
 *
 * Both provider drains route their give-up here so the two read identically on
 * `admin/jobs`, and so the reason a resync stopped is recorded once rather than
 * spelled differently per provider.
 */

import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/** Names this drain on the rows it writes. */
export const FORCE_RESYNC_JOB_KIND = "integrations.forceResync";

export async function recordForceResyncGaveUp(
  ctx: ActionCtx,
  args: {
    provider: "github" | "gitlab";
    projectIntegrationLinkId: Id<"projectIntegrationLinks">;
    /** Index into the link's resync items the drain died at. */
    offset: number;
    reason: string;
  },
): Promise<void> {
  console.error(
    `[${args.provider}/forceResync] gave up at item ${args.offset}`,
    args.reason,
  );
  await ctx.runMutation(
    internal.backgroundJobFailures.recordOutboundAbandoned,
    {
      kind: FORCE_RESYNC_JOB_KIND,
      key: args.projectIntegrationLinkId,
      // The offset matters to whoever reads this: everything before it
      // converged and everything after it did not, so a re-run is safe but
      // the link is known-diverged until one happens.
      error:
        `${args.provider} force resync abandoned at item ${args.offset} ` +
        `(items before it converged, items after it did not): ${args.reason}`,
    },
  );
}

/** A thrown value, rendered for the operator row. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
