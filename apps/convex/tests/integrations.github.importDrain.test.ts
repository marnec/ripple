import { describe, expect, it } from "vitest";
import { normalizeImportBatch } from "../convex/integrations/github/importDrain";

function rawIssue(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    node_id: "I_kwDO1",
    number: 1,
    title: "Hello",
    body: "Body",
    state: "open" as const,
    state_reason: null,
    html_url: "https://github.com/acme/web/issues/1",
    updated_at: "2026-05-15T10:00:00Z",
    user: {
      login: "octocat",
      avatar_url: "https://example.com/a.png",
      html_url: "https://github.com/octocat",
    },
    ...overrides,
  };
}

describe("integrations/github/importDrain.normalizeImportBatch", () => {
  it("maps open issues to NormalizedIssueOpenedEvent", () => {
    const out = normalizeImportBatch([rawIssue()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "issue.opened",
      externalIssueId: "I_kwDO1",
      issueNumber: 1,
      title: "Hello",
    });
  });

  it("maps closed issues to NormalizedIssueClosedEvent with stateReason fallback", () => {
    const out = normalizeImportBatch([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawIssue({ state: "closed", state_reason: null }) as any,
    ]);
    expect(out[0]).toMatchObject({
      kind: "issue.closed",
      stateReason: "completed",
    });
  });

  it("propagates state_reason='not_planned' for closed issues that have it", () => {
    const out = normalizeImportBatch([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawIssue({ state: "closed", state_reason: "not_planned" }) as any,
    ]);
    expect(out[0]).toMatchObject({ stateReason: "not_planned" });
  });

  it("drops entries that GitHub flags as pull requests (the REST list endpoint conflates them)", () => {
    const out = normalizeImportBatch([
      rawIssue({ number: 1 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawIssue({ number: 2, pull_request: { url: "anything" } }) as any,
      rawIssue({ number: 3 }),
    ]);
    expect(out.map((e) => e.issueNumber)).toEqual([1, 3]);
  });
});
