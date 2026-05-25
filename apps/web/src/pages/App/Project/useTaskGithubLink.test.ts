import { describe, expect, it } from "vitest";
import {
  deriveSyncErrorLabel,
  deriveTaskGithubView,
} from "./useTaskGithubLink";

/**
 * Pure tests for the task-detail GitHub view model. These cover the
 * derivations the three task-detail components used to each do inline — most
 * importantly the brittle sync-error label match, which now has one home.
 */

describe("deriveSyncErrorLabel", () => {
  it("prefers the HTTP status code when present", () => {
    expect(deriveSyncErrorLabel("anything", 404)).toBe("HTTP 404");
    expect(deriveSyncErrorLabel("credentials bad", 401)).toBe("HTTP 401");
  });

  it("labels a credentials failure AUTH when no status is known", () => {
    expect(deriveSyncErrorLabel("GitHub App credentials not configured")).toBe(
      "AUTH",
    );
    expect(deriveSyncErrorLabel("Bad CREDENTIALS")).toBe("AUTH");
  });

  it("falls back to NET for any other statusless failure", () => {
    expect(deriveSyncErrorLabel("ECONNRESET")).toBe("NET");
  });
});

type Link = NonNullable<Parameters<typeof deriveTaskGithubView>[0]>;
// getByTask always returns these two booleans; fill them so partial fixtures
// satisfy the type while each test sets only the fields it cares about.
const mkLink = (partial: Partial<Link> = {}): Link => ({
  seedExpected: false,
  descriptionSnapshotId: null,
  ...partial,
});

describe("deriveTaskGithubView", () => {
  it("undefined (loading) → not linked, everything empty", () => {
    expect(deriveTaskGithubView(undefined)).toEqual({
      isLinked: false,
      syncError: null,
      shadowAssignees: [],
      closedBy: null,
      issueDeleted: false,
      descriptionLastSyncedAt: null,
      descriptionEdited: false,
    });
  });

  it("null (Ripple-native task) → not linked", () => {
    expect(deriveTaskGithubView(null).isLinked).toBe(false);
  });

  it("a healthy link → linked with no sync error and defaulted collections", () => {
    const view = deriveTaskGithubView(mkLink());
    expect(view.isLinked).toBe(true);
    expect(view.syncError).toBeNull();
    expect(view.shadowAssignees).toEqual([]);
    expect(view.closedBy).toBeNull();
    expect(view.descriptionLastSyncedAt).toBeNull();
    expect(view.descriptionEdited).toBe(false);
  });

  it("a failed link → shapes the sync error with a derived label", () => {
    const view = deriveTaskGithubView(
      mkLink({ lastSyncError: { occurredAt: 1, message: "Not Found", httpStatus: 404 } }),
    );
    expect(view.syncError).toEqual({
      message: "Not Found",
      httpStatus: 404,
      label: "HTTP 404",
    });
  });

  it("passes shadow assignees, closer, last-synced, and descriptionEdited through", () => {
    const closedBy = { login: "octo", avatarUrl: "a", url: "u" };
    const shadow = [{ login: "alice", avatarUrl: "a2", url: "u2" }];
    const view = deriveTaskGithubView(
      mkLink({
        externalAssignees: shadow,
        externalClosedBy: closedBy,
        descriptionLastSyncedAt: 1_700_000_000_000,
        descriptionEdited: true,
      }),
    );
    expect(view.shadowAssignees).toBe(shadow);
    expect(view.closedBy).toBe(closedBy);
    expect(view.descriptionLastSyncedAt).toBe(1_700_000_000_000);
    expect(view.descriptionEdited).toBe(true);
  });
});
