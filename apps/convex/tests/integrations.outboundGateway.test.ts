import { describe, expect, it } from "vitest";
import { buildGithubGateway } from "../convex/integrations/github/outboundGateway";
import type { InstallationRequester } from "../convex/integrations/github/outboundGateway";
import type { GithubResponse } from "../convex/integrations/github/client";

/**
 * Gateway-level tests for the GitHub HTTP semantics — classification, the
 * multi-request fan-out (labels = POST adds + DELETE removes), the
 * 404-on-DELETE-is-benign rule, and success-meta extraction. A fake
 * `InstallationRequester` returns canned responses, so these run with no token
 * minting, no env, and no real HTTP.
 */

type RequestArgs = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
};

function fakeClient(
  responder: (args: RequestArgs) => GithubResponse<unknown>,
) {
  const calls: RequestArgs[] = [];
  const client: InstallationRequester = {
    request: async <T,>(args: RequestArgs) => {
      calls.push(args);
      return responder(args) as GithubResponse<T>;
    },
  };
  return { client, calls };
}

const gw = (client: InstallationRequester) => buildGithubGateway(client);

describe("buildGithubGateway.setIssueState", () => {
  it("success extracts GitHub's updated_at from the 2xx body", async () => {
    const ts = "2026-05-22T10:00:00Z";
    const { client, calls } = fakeClient(() => ({
      status: 200,
      body: { updated_at: ts },
    }));

    const outcome = await gw(client).setIssueState({
      projectRef: "acme/web",
      issueRef: 42,
      state: "closed",
      stateReason: "completed",
    });

    expect(outcome).toEqual({
      kind: "success",
      meta: { externalUpdatedAt: Date.parse(ts) },
    });
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      path: "/repos/acme/web/issues/42",
      body: { state: "closed", state_reason: "completed" },
    });
  });

  it("4xx (non-429) maps to permanent_fail with the status", async () => {
    const { client } = fakeClient(() => ({
      status: 422,
      errorMessage: "Unprocessable",
    }));

    const outcome = await gw(client).setIssueState({
      projectRef: "acme/web",
      issueRef: 42,
      state: "open",
    });

    expect(outcome).toEqual({
      kind: "permanent_fail",
      message: "Unprocessable",
      httpStatus: 422,
    });
  });

  it("5xx maps to retryable", async () => {
    const { client } = fakeClient(() => ({ status: 503 }));
    const outcome = await gw(client).setIssueState({
      projectRef: "acme/web",
      issueRef: 42,
      state: "open",
    });
    expect(outcome.kind).toBe("retryable");
  });
});

describe("buildGithubGateway.setLabels", () => {
  it("POSTs adds then DELETEs removes, succeeding overall", async () => {
    const { client, calls } = fakeClient(() => ({ status: 200 }));

    const outcome = await gw(client).setLabels({
      projectRef: "acme/web",
      issueRef: 42,
      add: ["bug"],
      remove: ["wontfix"],
    });

    expect(outcome).toEqual({ kind: "success", meta: {} });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /repos/acme/web/issues/42/labels",
      "DELETE /repos/acme/web/issues/42/labels/wontfix",
    ]);
  });

  it("treats a 404 on a label DELETE as benign and keeps going", async () => {
    const { client, calls } = fakeClient((args) =>
      args.method === "DELETE" ? { status: 404 } : { status: 200 },
    );

    const outcome = await gw(client).setLabels({
      projectRef: "acme/web",
      issueRef: 42,
      add: [],
      remove: ["already-gone", "also-gone"],
    });

    expect(outcome).toEqual({ kind: "success", meta: {} });
    expect(calls).toHaveLength(2); // both DELETEs attempted, neither failed
  });

  it("short-circuits on a permanent failure during the add POST", async () => {
    const { client, calls } = fakeClient(() => ({
      status: 403,
      errorMessage: "Forbidden",
    }));

    const outcome = await gw(client).setLabels({
      projectRef: "acme/web",
      issueRef: 42,
      add: ["bug"],
      remove: ["wontfix"],
    });

    expect(outcome).toMatchObject({ kind: "permanent_fail", httpStatus: 403 });
    expect(calls).toHaveLength(1); // never reached the DELETE
  });
});

describe("buildGithubGateway.createComment", () => {
  it("success extracts the comment id, updated_at, and author", async () => {
    const ts = "2026-05-22T11:00:00Z";
    const { client } = fakeClient(() => ({
      status: 201,
      body: {
        id: 9001,
        node_id: "IC_node",
        updated_at: ts,
        user: {
          login: "octocat",
          avatar_url: "https://avatars/octocat.png",
          html_url: "https://github.com/octocat",
        },
      },
    }));

    const outcome = await gw(client).createComment({
      projectRef: "acme/web",
      issueRef: 42,
      body: "hello",
    });

    expect(outcome).toEqual({
      kind: "success",
      meta: {
        externalCommentId: "9001",
        externalUpdatedAt: Date.parse(ts),
        externalAuthor: {
          login: "octocat",
          avatarUrl: "https://avatars/octocat.png",
          url: "https://github.com/octocat",
        },
      },
    });
  });

  it("a 2xx with no body is retryable (never records a bogus link row)", async () => {
    const { client } = fakeClient(() => ({ status: 201 }));
    const outcome = await gw(client).createComment({
      projectRef: "acme/web",
      issueRef: 42,
      body: "hello",
    });
    expect(outcome.kind).toBe("retryable");
  });
});

/**
 * The comment-create convergence guard. `createComment` is the second
 * non-idempotent POST in the outbound surface, and the retrier re-runs it
 * whenever an attempt fails after the POST committed — a dropped response, a
 * timeout past the write. This is what lets the retry find the comment its
 * predecessor already posted instead of posting a second one on the customer's
 * issue tracker.
 */
describe("buildGithubGateway.findCommentByRippleComment", () => {
  const COMMENT_ID = "js71commentsample01234567890abcd";

  function commentJson(overrides: Record<string, unknown> = {}) {
    return {
      id: 9001,
      node_id: "IC_kw1",
      body: `Looks good.\n\n<!-- ripple-comment: ${COMMENT_ID} -->`,
      updated_at: "2026-05-22T10:00:00Z",
      issue_url: "https://api.github.com/repos/acme/web/issues/42",
      user: {
        login: "ripple[bot]",
        avatar_url: "https://avatars/bot.png",
        html_url: "https://github.com/apps/ripple",
      },
      ...overrides,
    };
  }

  it("finds the comment the lost attempt posted, and returns the meta the sink needs", async () => {
    const { client, calls } = fakeClient(() => ({
      status: 200,
      body: [commentJson({ id: 1, body: "unrelated", issue_url: "https://api.github.com/repos/acme/web/issues/42" }), commentJson()],
    }));

    const lookup = await gw(client).findCommentByRippleComment({
      projectRef: "acme/web",
      issueRef: 42,
      commentId: COMMENT_ID,
    });

    expect(lookup).toEqual({
      kind: "found",
      meta: {
        externalCommentId: "9001",
        externalUpdatedAt: Date.parse("2026-05-22T10:00:00Z"),
        externalAuthor: {
          login: "ripple[bot]",
          avatarUrl: "https://avatars/bot.png",
          url: "https://github.com/apps/ripple",
        },
      },
    });
    // Newest-first across the repo: the per-issue endpoint returns comments
    // oldest-first with no sort parameter, so the comment just posted would sit
    // on the last page of a busy issue and never be seen.
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toContain("/repos/acme/web/issues/comments");
    expect(calls[0].path).toContain("direction=desc");
  });

  it("is absent when no recent comment carries the marker", async () => {
    const { client } = fakeClient(() => ({
      status: 200,
      body: [commentJson({ body: "someone else entirely" })],
    }));

    expect(
      await gw(client).findCommentByRippleComment({
        projectRef: "acme/web",
        issueRef: 42,
        commentId: COMMENT_ID,
      }),
    ).toEqual({ kind: "absent" });
  });

  /**
   * A marker is unique per Ripple comment, so this is belt-and-braces — but a
   * hit under a different issue would write a link row pointing at the wrong
   * task link, which is worse than the duplicate the lookup exists to prevent.
   */
  it("ignores a marker hit that belongs to a different issue", async () => {
    const { client } = fakeClient(() => ({
      status: 200,
      body: [
        commentJson({
          issue_url: "https://api.github.com/repos/acme/web/issues/999",
        }),
      ],
    }));

    expect(
      await gw(client).findCommentByRippleComment({
        projectRef: "acme/web",
        issueRef: 42,
        commentId: COMMENT_ID,
      }),
    ).toEqual({ kind: "absent" });
  });

  /**
   * A degraded lookup must not block the create: refusing to post a comment
   * because the *search* is rate-limited is a worse failure than the duplicate
   * it would prevent. The runner only short-circuits on a definite "found".
   */
  it("reports unavailable rather than absent when the scan itself fails", async () => {
    const { client } = fakeClient(() => ({
      status: 403,
      errorMessage: "rate limited",
    }));

    expect(
      await gw(client).findCommentByRippleComment({
        projectRef: "acme/web",
        issueRef: 42,
        commentId: COMMENT_ID,
      }),
    ).toMatchObject({ kind: "unavailable" });
  });
});

describe("buildGithubGateway.deleteComment", () => {
  it("treats a 404 as success (comment already gone)", async () => {
    const { client } = fakeClient(() => ({ status: 404 }));
    const outcome = await gw(client).deleteComment({
      projectRef: "acme/web",
      externalCommentId: "9001",
    });
    expect(outcome).toEqual({ kind: "success", meta: {} });
  });

  it("treats a 204 as success", async () => {
    const { client } = fakeClient(() => ({ status: 204 }));
    const outcome = await gw(client).deleteComment({
      projectRef: "acme/web",
      externalCommentId: "9001",
    });
    expect(outcome).toEqual({ kind: "success", meta: {} });
  });
});

/**
 * The create-dedupe lookup. A retried create must be able to see the issue a
 * previous attempt already made, and the only thing tying that issue to the
 * task is the `<!-- ripple-task: … -->` marker the create appended to its
 * body. This scans the newest issues rather than asking GitHub's search API:
 * search indexes asynchronously, so the issue created seconds ago — precisely
 * the one this lookup exists to find — is routinely not yet findable.
 */
describe("buildGithubGateway.findIssueByRippleTask", () => {
  const TASK_ID = "k5738j2h9wq1abcdefgh12345678";

  it("requests the newest issues in the repo, both open and closed", async () => {
    const { client, calls } = fakeClient(() => ({ status: 200, body: [] }));

    await gw(client).findIssueByRippleTask({
      projectRef: "acme/web",
      taskId: TASK_ID,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    const [path, query] = calls[0].path.split("?");
    expect(path).toBe("/repos/acme/web/issues");
    const params = new URLSearchParams(query);
    expect(params.get("state")).toBe("all");
    expect(params.get("sort")).toBe("created");
    expect(params.get("direction")).toBe("desc");
    expect(Number(params.get("per_page"))).toBeGreaterThanOrEqual(50);
  });

  it("returns the issue whose body carries this task's marker, with full create meta", async () => {
    const updated = "2026-05-22T10:00:00Z";
    const { client } = fakeClient(() => ({
      status: 200,
      body: [
        { node_id: "I_other", number: 8, body: "unrelated", updated_at: updated,
          user: { login: "human", avatar_url: "a", html_url: "u" } },
        {
          node_id: "I_mine",
          number: 9,
          body: `Seeded body\n\n<!-- ripple-task: ${TASK_ID} -->`,
          updated_at: updated,
          user: { login: "ripple[bot]", avatar_url: "av", html_url: "url" },
        },
      ],
    }));

    const found = await gw(client).findIssueByRippleTask({
      projectRef: "acme/web",
      taskId: TASK_ID,
    });

    expect(found).toEqual({
      kind: "found",
      meta: {
        externalIssueId: "I_mine",
        issueNumber: 9,
        externalUpdatedAt: Date.parse(updated),
        externalAuthor: { login: "ripple[bot]", avatarUrl: "av", url: "url" },
      },
    });
  });

  it("another task's marker is not this task's issue", async () => {
    const { client } = fakeClient(() => ({
      status: 200,
      body: [
        {
          node_id: "I_theirs",
          number: 8,
          body: "<!-- ripple-task: zzzz8j2h9wq1abcdefgh12345678 -->",
          updated_at: "2026-05-22T10:00:00Z",
          user: { login: "ripple[bot]", avatar_url: "a", html_url: "u" },
        },
      ],
    }));

    expect(
      await gw(client).findIssueByRippleTask({
        projectRef: "acme/web",
        taskId: TASK_ID,
      }),
    ).toEqual({ kind: "absent" });
  });

  it("an unusable response is `unavailable`, never `absent` — a create must not be skipped on a guess", async () => {
    const rateLimited = fakeClient(() => ({
      status: 429,
      errorMessage: "rate limited",
    }));
    const forbidden = fakeClient(() => ({ status: 403, errorMessage: "no" }));
    const bodyless = fakeClient(() => ({ status: 200 }));

    for (const { client } of [rateLimited, forbidden, bodyless]) {
      const outcome = await gw(client).findIssueByRippleTask({
        projectRef: "acme/web",
        taskId: TASK_ID,
      });
      expect(outcome.kind).toBe("unavailable");
    }
  });
});
