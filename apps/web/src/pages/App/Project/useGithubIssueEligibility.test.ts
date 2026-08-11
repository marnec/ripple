import { describe, expect, it } from "vitest";
import { deriveCreateIssueAffordance } from "./useGithubIssueEligibility";

/**
 * The whole "can this task spawn an issue?" rule, as data. It used to be split
 * between the hook (`eligible`) and the button's JSX (`isLinked || completed`
 * plus a three-branch title ternary), so it could only be read by reading both.
 */
describe("deriveCreateIssueAffordance", () => {
  const base = {
    eligible: true,
    provider: "github",
    isLinked: false,
    completed: false,
  };

  it("is offered and enabled for an unlinked, open task", () => {
    expect(deriveCreateIssueAffordance(base)).toEqual({
      show: true,
      disabled: false,
      reason: "Create GitHub issue from this task",
    });
  });

  it("is not offered at all when the project has no eligible integration", () => {
    const a = deriveCreateIssueAffordance({ ...base, eligible: false });
    expect(a.show).toBe(false);
  });

  it("stays in place but disables once the task is already linked", () => {
    expect(deriveCreateIssueAffordance({ ...base, isLinked: true })).toEqual({
      show: true,
      disabled: true,
      reason: "Already linked to a GitHub issue",
    });
  });

  it("stays in place but disables for a completed task", () => {
    expect(deriveCreateIssueAffordance({ ...base, completed: true })).toEqual({
      show: true,
      disabled: true,
      reason: "Completed tasks can't create an issue",
    });
  });

  it("explains the link rather than the completion when both apply", () => {
    const a = deriveCreateIssueAffordance({
      ...base,
      isLinked: true,
      completed: true,
    });
    expect(a.reason).toBe("Already linked to a GitHub issue");
  });

  it("names the project's own provider in the copy", () => {
    expect(deriveCreateIssueAffordance({ ...base, provider: "gitlab" }).reason).toBe(
      "Create GitLab issue from this task",
    );
    expect(
      deriveCreateIssueAffordance({
        ...base,
        provider: "gitlab",
        isLinked: true,
      }).reason,
    ).toBe("Already linked to a GitLab issue");
  });
});
