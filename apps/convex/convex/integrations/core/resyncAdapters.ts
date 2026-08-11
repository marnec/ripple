import { internal } from "../../_generated/api";
import type { FunctionReference } from "convex/server";
import type { Id } from "../../_generated/dataModel";

/**
 * Force-resync dispatch registry — the resync-path twin of
 * `core/outboundAdapters` and `core/branchAdapters` (issue #44, seam 1).
 *
 * `core/links.forceResync` is provider-agnostic, but it used to schedule
 * `internal.integrations.github.forceResyncAction.runForceResync` unconditionally
 * — so "Force resync" on a GitLab link fired GitHub's action, which then asked
 * for an installation token for an installation id that is really a GitLab
 * credential ref. Every fetch failed and the user saw a silent no-op. This maps
 * a provider to its own resync action; the mutation resolves the adapter and
 * schedules through it.
 *
 * Adding a provider is a data change here (register its
 * `<provider>/forceResyncAction`). An unregistered provider resolves to `null`
 * and the mutation refuses rather than falling back to another provider's API.
 */

/**
 * The resync action contract. `offset` is the drain cursor into
 * `getResyncContext().items`; the first invocation omits it and each adapter
 * self-reschedules to drain the rest.
 */
type RunForceResyncRef = FunctionReference<
  "action",
  "internal",
  {
    projectIntegrationLinkId: Id<"projectIntegrationLinks">;
    offset?: number;
  },
  null
>;

export interface ResyncAdapter {
  runForceResync: RunForceResyncRef;
}

const GITHUB_RESYNC_ADAPTER: ResyncAdapter = {
  runForceResync: internal.integrations.github.forceResyncAction
    .runForceResync as unknown as RunForceResyncRef,
};

const GITLAB_RESYNC_ADAPTER: ResyncAdapter = {
  runForceResync: internal.integrations.gitlab.forceResyncAction
    .runForceResync as unknown as RunForceResyncRef,
};

const ADAPTERS: Record<string, ResyncAdapter> = {
  github: GITHUB_RESYNC_ADAPTER,
  gitlab: GITLAB_RESYNC_ADAPTER,
};

/**
 * Resolve the force-resync adapter for a provider, or `null` when none is
 * registered (the caller must then refuse the resync — never fall back to
 * another provider).
 */
export function resolveResyncAdapter(provider: string): ResyncAdapter | null {
  return ADAPTERS[provider] ?? null;
}
