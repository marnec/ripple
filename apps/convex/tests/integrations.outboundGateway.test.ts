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
