import { describe, expect, it } from "vitest";
import {
  OUTBOUND_OPS,
  resolveOutboundAdapter,
} from "../convex/integrations/core/outboundAdapters";

/**
 * The outbound dispatch registry (seam 1). Maps a link's provider to its
 * action FunctionReferences + onComplete callback, so the provider-agnostic
 * dispatch layer routes to the right adapter instead of hardcoding GitHub.
 * The safety property: an unregistered provider resolves to null (the dispatch
 * layer then refuses to push) — a GitLab-linked task must NOT push to GitHub.
 */
describe("integrations/core/outboundAdapters.resolveOutboundAdapter", () => {
  it("resolves the github adapter with a reference for every outbound op", () => {
    const adapter = resolveOutboundAdapter("github");
    expect(adapter).not.toBeNull();
    for (const op of OUTBOUND_OPS) {
      expect(adapter!.ops[op], `missing ref for op ${op}`).toBeTruthy();
    }
    expect(adapter!.onComplete).toBeTruthy();
  });

  it("maps distinct ops to distinct action references", () => {
    const adapter = resolveOutboundAdapter("github")!;
    expect(adapter.ops.createIssue).not.toBe(adapter.ops.issueState);
    expect(adapter.ops.commentCreate).not.toBe(adapter.ops.commentDelete);
  });

  it("resolves the gitlab adapter to its own (distinct) action set", () => {
    const gh = resolveOutboundAdapter("github")!;
    const gl = resolveOutboundAdapter("gitlab");
    expect(gl).not.toBeNull();
    // A GitLab op must route to a GitLab action, never GitHub's.
    expect(gl!.ops.createIssue).not.toBe(gh.ops.createIssue);
    expect(gl!.ops.issueState).not.toBe(gh.ops.issueState);
  });

  it("returns null for an unregistered provider (no fallback)", () => {
    expect(resolveOutboundAdapter("bitbucket")).toBeNull();
    expect(resolveOutboundAdapter("")).toBeNull();
  });
});
