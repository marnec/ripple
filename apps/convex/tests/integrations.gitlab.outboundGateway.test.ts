import { describe, expect, it } from "vitest";
import {
  buildGitlabGateway,
  type GitlabRequester,
  type GitlabResponse,
} from "../convex/integrations/gitlab/outboundGateway";

/**
 * GitLab implementation of the OutboundGateway port. Tested through a fake
 * requester (no token, no HTTP) exactly like the GitHub gateway — asserting the
 * GitLab-specific REST semantics: URL-encoded project path, `state_event`
 * (not `state`), comma-joined `add_labels`/`remove_labels`, `assignee_ids`,
 * and notes addressed by project + issue iid + note id.
 */
type RequestArgs = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
};

function fakeClient(responder: (args: RequestArgs) => GitlabResponse<unknown>) {
  const calls: RequestArgs[] = [];
  const client: GitlabRequester = {
    request: async <T,>(args: RequestArgs) => {
      calls.push(args);
      return responder(args) as GitlabResponse<T>;
    },
  };
  return { client, calls };
}

const gw = (client: GitlabRequester) => buildGitlabGateway(client);

describe("integrations/gitlab/outboundGateway.buildGitlabGateway", () => {
  it("createIssue POSTs title+description and extracts the global id, iid, author", async () => {
    const ts = "2026-05-22T10:00:00Z";
    const { client, calls } = fakeClient(() => ({
      status: 201,
      body: {
        id: 301,
        iid: 7,
        web_url: "https://gitlab.com/acme/web/-/issues/7",
        updated_at: ts,
        author: {
          username: "bot",
          avatar_url: "https://gitlab.com/bot.png",
          web_url: "https://gitlab.com/bot",
        },
      },
    }));

    const outcome = await gw(client).createIssue({
      projectRef: "acme/web",
      title: "Fix login",
      body: "repro",
    });

    expect(outcome).toEqual({
      kind: "success",
      meta: {
        externalIssueId: "301",
        issueNumber: 7,
        externalUpdatedAt: Date.parse(ts),
        externalAuthor: {
          login: "bot",
          avatarUrl: "https://gitlab.com/bot.png",
          url: "https://gitlab.com/bot",
        },
      },
    });
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/projects/acme%2Fweb/issues",
      body: { title: "Fix login", description: "repro" },
    });
  });

  it("setIssueState closes via state_event (GitLab has no state= field)", async () => {
    const ts = "2026-05-22T11:00:00Z";
    const { client, calls } = fakeClient(() => ({
      status: 200,
      body: { updated_at: ts },
    }));

    const outcome = await gw(client).setIssueState({
      projectRef: "acme/web",
      issueRef: 7,
      state: "closed",
      stateReason: "completed",
    });

    expect(outcome).toEqual({
      kind: "success",
      meta: { externalUpdatedAt: Date.parse(ts) },
    });
    expect(calls[0]).toMatchObject({
      method: "PUT",
      path: "/projects/acme%2Fweb/issues/7",
      body: { state_event: "close" },
    });
  });

  it("setIssueState reopens via state_event reopen", async () => {
    const { client, calls } = fakeClient(() => ({
      status: 200,
      body: { updated_at: "2026-05-22T11:00:00Z" },
    }));
    await gw(client).setIssueState({
      projectRef: "acme/web",
      issueRef: 7,
      state: "open",
    });
    expect(calls[0].body).toEqual({ state_event: "reopen" });
  });

  it("setLabels PUTs comma-joined add_labels/remove_labels in one request", async () => {
    const { client, calls } = fakeClient(() => ({ status: 200, body: {} }));
    const outcome = await gw(client).setLabels({
      projectRef: "acme/web",
      issueRef: 7,
      add: ["bug", "p1"],
      remove: ["stale"],
    });
    expect(outcome.kind).toBe("success");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "PUT",
      path: "/projects/acme%2Fweb/issues/7",
      body: { add_labels: "bug,p1", remove_labels: "stale" },
    });
  });

  it("setAssignees PUTs assignee_ids from the add set (parsed to numbers)", async () => {
    const { client, calls } = fakeClient(() => ({ status: 200, body: {} }));
    await gw(client).setAssignees({
      projectRef: "acme/web",
      issueRef: 7,
      add: ["42"],
      remove: ["9"],
    });
    expect(calls[0]).toMatchObject({
      method: "PUT",
      path: "/projects/acme%2Fweb/issues/7",
      body: { assignee_ids: [42] },
    });
  });

  it("setAssignees clears with an empty assignee_ids when add is empty", async () => {
    const { client, calls } = fakeClient(() => ({ status: 200, body: {} }));
    await gw(client).setAssignees({
      projectRef: "acme/web",
      issueRef: 7,
      add: [],
      remove: ["9"],
    });
    expect(calls[0].body).toEqual({ assignee_ids: [] });
  });

  it("createComment POSTs to notes and extracts the note id + author", async () => {
    const ts = "2026-05-22T12:00:00Z";
    const { client, calls } = fakeClient(() => ({
      status: 201,
      body: {
        id: 555,
        updated_at: ts,
        author: {
          username: "bot",
          avatar_url: "https://gitlab.com/bot.png",
          web_url: "https://gitlab.com/bot",
        },
      },
    }));
    const outcome = await gw(client).createComment({
      projectRef: "acme/web",
      issueRef: 7,
      body: "hi",
    });
    expect(outcome).toEqual({
      kind: "success",
      meta: {
        externalCommentId: "555",
        externalUpdatedAt: Date.parse(ts),
        externalAuthor: {
          login: "bot",
          avatarUrl: "https://gitlab.com/bot.png",
          url: "https://gitlab.com/bot",
        },
      },
    });
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/projects/acme%2Fweb/issues/7/notes",
      body: { body: "hi" },
    });
  });

  it("editComment PUTs the note addressed by project + issue iid + note id", async () => {
    const { client, calls } = fakeClient(() => ({
      status: 200,
      body: { updated_at: "2026-05-22T12:30:00Z" },
    }));
    await gw(client).editComment({
      projectRef: "acme/web",
      issueRef: 7,
      externalCommentId: "555",
      body: "edited",
    });
    expect(calls[0]).toMatchObject({
      method: "PUT",
      path: "/projects/acme%2Fweb/issues/7/notes/555",
      body: { body: "edited" },
    });
  });

  it("deleteComment DELETEs the note; a 404 is benign success", async () => {
    const { client, calls } = fakeClient(() => ({ status: 404 }));
    const outcome = await gw(client).deleteComment({
      projectRef: "acme/web",
      issueRef: 7,
      externalCommentId: "555",
    });
    expect(outcome.kind).toBe("success");
    expect(calls[0]).toMatchObject({
      method: "DELETE",
      path: "/projects/acme%2Fweb/issues/7/notes/555",
    });
  });

  it("maps a 422 to permanent_fail and a 503 to retryable", async () => {
    const perm = await gw(
      fakeClient(() => ({ status: 422, errorMessage: "bad" })).client,
    ).setDescription({ projectRef: "acme/web", issueRef: 7, markdown: "x" });
    expect(perm).toMatchObject({ kind: "permanent_fail", httpStatus: 422 });

    const retry = await gw(
      fakeClient(() => ({ status: 503 })).client,
    ).setDescription({ projectRef: "acme/web", issueRef: 7, markdown: "x" });
    expect(retry.kind).toBe("retryable");
  });
});

/**
 * GitLab's half of the create-dedupe lookup. Same contract as GitHub's, same
 * reason it lists rather than searches — one shape of answer for the runner,
 * whichever provider the link points at.
 */
describe("integrations/gitlab/outboundGateway.findIssueByRippleTask", () => {
  const TASK_ID = "k5738j2h9wq1abcdefgh12345678";

  it("lists the project's newest issues, url-encoding the project path", async () => {
    const { client, calls } = fakeClient(() => ({ status: 200, body: [] }));

    await gw(client).findIssueByRippleTask({
      projectRef: "acme/web",
      taskId: TASK_ID,
    });

    expect(calls[0].method).toBe("GET");
    const [path, query] = calls[0].path.split("?");
    expect(path).toBe("/projects/acme%2Fweb/issues");
    const params = new URLSearchParams(query);
    expect(params.get("order_by")).toBe("created_at");
    expect(params.get("sort")).toBe("desc");
    expect(Number(params.get("per_page"))).toBeGreaterThanOrEqual(50);
  });

  it("matches the marker in `description` and returns GitLab's id/iid/author", async () => {
    const ts = "2026-05-22T10:00:00Z";
    const { client } = fakeClient(() => ({
      status: 200,
      body: [
        {
          id: 301,
          iid: 7,
          description: `body\n\n<!-- ripple-task: ${TASK_ID} -->`,
          updated_at: ts,
          author: {
            username: "bot",
            avatar_url: "https://gitlab.com/bot.png",
            web_url: "https://gitlab.com/bot",
          },
        },
      ],
    }));

    expect(
      await gw(client).findIssueByRippleTask({
        projectRef: "acme/web",
        taskId: TASK_ID,
      }),
    ).toEqual({
      kind: "found",
      meta: {
        externalIssueId: "301",
        issueNumber: 7,
        externalUpdatedAt: Date.parse(ts),
        externalAuthor: {
          login: "bot",
          avatarUrl: "https://gitlab.com/bot.png",
          url: "https://gitlab.com/bot",
        },
      },
    });
  });

  it("no marker is `absent`; an unusable response is `unavailable`", async () => {
    const empty = fakeClient(() => ({
      status: 200,
      body: [{ id: 1, iid: 1, description: null, updated_at: "2026-05-22T10:00:00Z",
              author: { username: "a", avatar_url: "b", web_url: "c" } }],
    }));
    const denied = fakeClient(() => ({ status: 403, errorMessage: "forbidden" }));

    expect(
      await gw(empty.client).findIssueByRippleTask({
        projectRef: "acme/web",
        taskId: TASK_ID,
      }),
    ).toEqual({ kind: "absent" });
    expect(
      (
        await gw(denied.client).findIssueByRippleTask({
          projectRef: "acme/web",
          taskId: TASK_ID,
        })
      ).kind,
    ).toBe("unavailable");
  });
});

/**
 * The GitLab half of the comment-create convergence guard. Unlike GitHub,
 * GitLab's per-issue notes endpoint takes `order_by`/`sort`, so the lookup can
 * stay scoped to the issue the comment belongs to — no cross-issue filter is
 * needed, because the query itself cannot return another issue's notes.
 */
describe("integrations/gitlab/outboundGateway.findCommentByRippleComment", () => {
  const COMMENT_ID = "js71commentsample01234567890abcd";

  function note(overrides: Record<string, unknown> = {}) {
    return {
      id: 555,
      body: `Looks good.\n\n<!-- ripple-comment: ${COMMENT_ID} -->`,
      updated_at: "2026-05-22T10:00:00Z",
      author: {
        username: "ripple-bot",
        avatar_url: "https://gitlab.com/bot.png",
        web_url: "https://gitlab.com/ripple-bot",
      },
      ...overrides,
    };
  }

  it("finds the note the lost attempt posted, newest-first under that issue", async () => {
    const { client, calls } = fakeClient(() => ({
      status: 200,
      body: [note({ id: 1, body: "system note" }), note()],
    }));

    const lookup = await gw(client).findCommentByRippleComment({
      projectRef: "acme/web",
      issueRef: 7,
      commentId: COMMENT_ID,
    });

    expect(lookup).toEqual({
      kind: "found",
      meta: {
        externalCommentId: "555",
        externalUpdatedAt: Date.parse("2026-05-22T10:00:00Z"),
        externalAuthor: {
          login: "ripple-bot",
          avatarUrl: "https://gitlab.com/bot.png",
          url: "https://gitlab.com/ripple-bot",
        },
      },
    });
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toContain("/projects/acme%2Fweb/issues/7/notes");
    expect(calls[0].path).toContain("sort=desc");
  });

  it("is absent when no recent note carries the marker", async () => {
    const { client } = fakeClient(() => ({
      status: 200,
      body: [note({ body: "someone else entirely" })],
    }));

    expect(
      await gw(client).findCommentByRippleComment({
        projectRef: "acme/web",
        issueRef: 7,
        commentId: COMMENT_ID,
      }),
    ).toEqual({ kind: "absent" });
  });

  it("reports unavailable rather than absent when the scan itself fails", async () => {
    const { client } = fakeClient(() => ({
      status: 429,
      errorMessage: "rate limited",
    }));

    expect(
      await gw(client).findCommentByRippleComment({
        projectRef: "acme/web",
        issueRef: 7,
        commentId: COMMENT_ID,
      }),
    ).toMatchObject({ kind: "unavailable" });
  });
});
