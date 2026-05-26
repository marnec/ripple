import { describe, expect, it } from "vitest";
import { mirrorFor } from "../convex/integrations/github/syncOutMutations";

/**
 * Pure tests for the op→mirror mapping that `recordTaskOutboundResult` applies.
 * This is the per-op variation that used to live in four near-identical
 * recorder mutations; pinning it here means the unified mutation only needs one
 * boundary test per *distinct* mirror shape.
 */
describe("mirrorFor", () => {
  it("labels → patches externalLabels only (no externalUpdatedAt bump)", () => {
    expect(mirrorFor({ op: "labels", nextLabels: ["bug", "p1"] })).toEqual({
      externalLabels: ["bug", "p1"],
    });
  });

  it("assignees → patches externalAssigneeLogins only", () => {
    expect(mirrorFor({ op: "assignees", nextLogins: ["octocat"] })).toEqual({
      externalAssigneeLogins: ["octocat"],
    });
  });

  it("description → stamps descriptionLastSyncedAt", () => {
    const before = Date.now();
    const mirror = mirrorFor({ op: "description" });
    expect(mirror.descriptionLastSyncedAt).toBeGreaterThanOrEqual(before);
    expect(Object.keys(mirror)).toEqual(["descriptionLastSyncedAt"]);
  });

  it("state closed → sets state + reason + GitHub's updated_at", () => {
    expect(
      mirrorFor({
        op: "state",
        state: "closed",
        stateReason: "not_planned",
        externalUpdatedAt: 1_700_000_500_000,
      }),
    ).toEqual({
      externalState: "closed",
      externalStateReason: "not_planned",
      externalUpdatedAt: 1_700_000_500_000,
    });
  });

  it("state closed without a reason defaults to completed", () => {
    expect(
      mirrorFor({ op: "state", state: "closed", externalUpdatedAt: 1 }),
    ).toMatchObject({ externalStateReason: "completed" });
  });

  it("state open → clears the reason (key present, undefined) so reopen drops a stale one", () => {
    const mirror = mirrorFor({ op: "state", state: "open", externalUpdatedAt: 1 });
    expect(mirror.externalState).toBe("open");
    expect("externalStateReason" in mirror).toBe(true);
    expect(mirror.externalStateReason).toBeUndefined();
  });
});
