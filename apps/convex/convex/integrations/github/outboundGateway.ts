import { classifyResponse, type OutboundResponse } from "../core/syncOut";
import type {
  OutboundGateway,
  OutboundOutcome,
  OutboundSuccessMeta,
} from "../core/outboundPort";
import { GithubClient, type GithubResponse } from "./client";

/**
 * GitHub implementation of the outbound `OutboundGateway` port.
 *
 * `buildGithubGateway` depends only on the minimal `OutboundHttpClient`
 * surface (which `GithubClient` satisfies), so tests inject a fake client that
 * returns canned `GithubResponse`s — exercising the fan-out / 404-benign /
 * classify rules with no token minting, no env, and no real HTTP.
 *
 * `makeGithubGateway` is the production entry: it reads the App credentials
 * from the environment (returning `null` when unconfigured so the caller can
 * record a permanent failure) and wires up a real `GithubClient`.
 */

/** The slice of `GithubClient` the gateway needs — the test seam. */
export interface OutboundHttpClient {
  mintInstallationToken(externalAccountId: string): Promise<string>;
  request<T = unknown>(args: {
    installationToken: string;
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
  }): Promise<GithubResponse<T>>;
}

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toResponse(res: GithubResponse): OutboundResponse {
  return {
    status: res.status as number | null,
    retryAfterMs: res.retryAfterMs,
    errorMessage: res.errorMessage,
  };
}

/**
 * Classify one response into an `OutboundOutcome`. On a "retry" classification
 * for a 429 with a `Retry-After`, pre-sleeps here (Node side) so the
 * orchestrator can throw immediately and stay pure. `meta` extracts the
 * success metadata from a 2xx body.
 */
async function foldResponse<T>(
  res: GithubResponse<T>,
  meta?: (body?: T) => OutboundSuccessMeta,
): Promise<OutboundOutcome> {
  const decision = classifyResponse(toResponse(res));
  if (decision === "success") {
    return { kind: "success", meta: meta?.(res.body) ?? {} };
  }
  if (decision === "permanent_fail") {
    return {
      kind: "permanent_fail",
      message: res.errorMessage ?? `HTTP ${res.status}`,
      httpStatus: typeof res.status === "number" ? res.status : undefined,
    };
  }
  if (res.status === 429 && res.retryAfterMs) await SLEEP(res.retryAfterMs);
  return { kind: "retryable", message: res.errorMessage ?? `HTTP ${res.status}` };
}

export function buildGithubGateway(
  client: OutboundHttpClient,
  installationId: string,
): OutboundGateway {
  // Mint once, lazily, and reuse across the (possibly multiple) requests a
  // single op makes.
  let tokenPromise: Promise<string> | null = null;
  const token = () =>
    (tokenPromise ??= client.mintInstallationToken(installationId));

  return {
    async setIssueState({ repoFullName, issueNumber, state, stateReason }) {
      const body: Record<string, string> = { state };
      if (state === "closed" && stateReason) body.state_reason = stateReason;
      const res = await client.request<{ updated_at: string }>({
        installationToken: await token(),
        method: "PATCH",
        path: `/repos/${repoFullName}/issues/${issueNumber}`,
        body,
      });
      return foldResponse(res, (b) => ({
        externalUpdatedAt: b?.updated_at ? Date.parse(b.updated_at) : undefined,
      }));
    },

    async setDescription({ repoFullName, issueNumber, markdown }) {
      const res = await client.request<unknown>({
        installationToken: await token(),
        method: "PATCH",
        path: `/repos/${repoFullName}/issues/${issueNumber}`,
        body: { body: markdown },
      });
      return foldResponse(res);
    },

    async setLabels({ repoFullName, issueNumber, add, remove }) {
      const tok = await token();
      // POST /labels auto-creates labels missing on the repo.
      if (add.length > 0) {
        const res = await client.request<unknown>({
          installationToken: tok,
          method: "POST",
          path: `/repos/${repoFullName}/issues/${issueNumber}/labels`,
          body: { labels: add },
        });
        const outcome = await foldResponse(res);
        if (outcome.kind !== "success") return outcome;
      }
      for (const name of remove) {
        const res = await client.request<unknown>({
          installationToken: tok,
          method: "DELETE",
          path: `/repos/${repoFullName}/issues/${issueNumber}/labels/${encodeURIComponent(name)}`,
        });
        // 404 means the label was already absent — treat as success so a
        // benign race (someone removed it on GitHub first) doesn't surface a
        // "Sync failed" affordance.
        if (res.status === 404) continue;
        const outcome = await foldResponse(res);
        if (outcome.kind !== "success") return outcome;
      }
      return { kind: "success", meta: {} };
    },

    async setAssignees({ repoFullName, issueNumber, add, remove }) {
      const tok = await token();
      if (add.length > 0) {
        const res = await client.request<unknown>({
          installationToken: tok,
          method: "POST",
          path: `/repos/${repoFullName}/issues/${issueNumber}/assignees`,
          body: { assignees: add },
        });
        const outcome = await foldResponse(res);
        if (outcome.kind !== "success") return outcome;
      }
      if (remove.length > 0) {
        const res = await client.request<unknown>({
          installationToken: tok,
          method: "DELETE",
          path: `/repos/${repoFullName}/issues/${issueNumber}/assignees`,
          body: { assignees: remove },
        });
        const outcome = await foldResponse(res);
        if (outcome.kind !== "success") return outcome;
      }
      return { kind: "success", meta: {} };
    },

    async createComment({ repoFullName, issueNumber, body }) {
      const res = await client.request<{
        id: number;
        node_id: string;
        updated_at: string;
        user: { login: string; avatar_url: string; html_url: string };
      }>({
        installationToken: await token(),
        method: "POST",
        path: `/repos/${repoFullName}/issues/${issueNumber}/comments`,
        body: { body },
      });
      const decision = classifyResponse(toResponse(res));
      if (decision === "success") {
        // A 2xx with no parseable body shouldn't happen on a comment POST;
        // treat it as transient rather than recording a bogus link row.
        if (!res.body) {
          return { kind: "retryable", message: "comment-create succeeded without a body" };
        }
        return {
          kind: "success",
          meta: {
            externalCommentId: String(res.body.id),
            externalUpdatedAt: Date.parse(res.body.updated_at),
            externalAuthor: {
              login: res.body.user.login,
              avatarUrl: res.body.user.avatar_url,
              url: res.body.user.html_url,
            },
          },
        };
      }
      return foldResponse(res); // permanent_fail / retryable mapping (incl. 429 sleep)
    },

    async editComment({ repoFullName, externalCommentId, body }) {
      const res = await client.request<{ updated_at: string }>({
        installationToken: await token(),
        method: "PATCH",
        path: `/repos/${repoFullName}/issues/comments/${externalCommentId}`,
        body: { body },
      });
      const decision = classifyResponse(toResponse(res));
      if (decision === "success") {
        if (!res.body) {
          return { kind: "retryable", message: "comment-edit succeeded without a body" };
        }
        return {
          kind: "success",
          meta: { externalUpdatedAt: Date.parse(res.body.updated_at) },
        };
      }
      return foldResponse(res);
    },

    async deleteComment({ repoFullName, externalCommentId }) {
      const res = await client.request<unknown>({
        installationToken: await token(),
        method: "DELETE",
        path: `/repos/${repoFullName}/issues/comments/${externalCommentId}`,
      });
      // 404 means the comment was already gone (deleted on GitHub first) —
      // a benign no-op, recorded as success.
      if (
        res.status === 404 ||
        (typeof res.status === "number" && res.status >= 200 && res.status < 300)
      ) {
        return { kind: "success", meta: {} };
      }
      return foldResponse(res);
    },
  };
}

/**
 * Production gateway. Returns `null` when the GitHub App credentials are not
 * configured — the caller records that as a permanent failure (the existing
 * "credentials not configured" affordance).
 */
export function makeGithubGateway(
  installationId: string,
): OutboundGateway | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKeyPem) return null;
  return buildGithubGateway(
    new GithubClient({ appId, privateKeyPem }),
    installationId,
  );
}
