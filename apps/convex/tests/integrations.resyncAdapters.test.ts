import { describe, expect, it } from "vitest";
import { resolveResyncAdapter } from "../convex/integrations/core/resyncAdapters";

/**
 * The force-resync dispatch registry — the resync-path twin of
 * `core/outboundAdapters` and `core/branchAdapters` (issue #44, seam 1).
 *
 * `core/links.forceResync` is provider-agnostic but used to schedule
 * `internal.integrations.github.forceResyncAction.runForceResync` unconditionally,
 * so a GitLab link's "Force resync" fired GitHub's action against a GitHub App
 * installation that does not exist. The safety property mirrors the other two
 * tables: a provider resolves to its OWN action, and an unregistered provider
 * resolves to `null` so the caller refuses rather than falling back to GitHub.
 */
describe("integrations/core/resyncAdapters.resolveResyncAdapter", () => {
  it("resolves the github adapter to github's resync action", () => {
    const adapter = resolveResyncAdapter("github");
    expect(adapter).not.toBeNull();
    expect(adapter!.runForceResync).toBeTruthy();
  });

  it("resolves the gitlab adapter to its own (distinct) resync action", () => {
    const gh = resolveResyncAdapter("github")!;
    const gl = resolveResyncAdapter("gitlab");
    expect(gl).not.toBeNull();
    expect(gl!.runForceResync).not.toBe(gh.runForceResync);
  });

  it("returns null for an unregistered provider (no fallback to github)", () => {
    expect(resolveResyncAdapter("bitbucket")).toBeNull();
    expect(resolveResyncAdapter("")).toBeNull();
  });
});
