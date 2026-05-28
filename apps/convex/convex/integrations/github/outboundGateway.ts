import { classifyResponse, type OutboundResponse } from "../core/syncOut";
import type {
  OutboundGateway,
  OutboundOutcome,
  OutboundSuccessMeta,
} from "../core/outboundPort";
import { githubClientFromEnv, type GithubResponse } from "./client";

/**
 * GitHub implementation of the outbound `OutboundGateway` port.
 *
 * `buildGithubGateway` depends only on the token-free `InstallationRequester`
 * surface (which `InstallationClient` satisfies), so tests inject a fake that
 * returns canned `GithubResponse`s — exercising the fan-out / 404-benign /
 * classify rules with no token minting, no env, and no real HTTP. Token
 * minting/caching is owned once by `InstallationClient`, not re-implemented
 * here.
 *
 * `makeGithubGateway` is the production entry: it builds a client from the App
 * credentials in the environment (returning `null` when unconfigured so the
 * caller can record a permanent failure) and binds it to the installation.
 */

/**
 * The token-free request surface the gateway drives — the test seam.
 * `InstallationClient` satisfies it structurally and owns the installation
 * token, so gateway methods express only the call, not the auth.
 */
export interface InstallationRequester {
  request<T = unknown>(args: {
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

export function buildGithubGateway(gh: InstallationRequester): OutboundGateway {
  return {
    async createIssue({ projectRef, title, body }) {
      const res = await gh.request<{
        node_id: string;
        number: number;
        updated_at: string;
        user: { login: string; avatar_url: string; html_url: string };
      }>({
        method: "POST",
        path: `/repos/${projectRef}/issues`,
        body: { title, body },
      });
      const decision = classifyResponse(toResponse(res));
      if (decision === "success") {
        // A 2xx create with no parseable body can't be linked back to a task;
        // treat as transient rather than recording a half-formed link.
        if (!res.body) {
          return { kind: "retryable", message: "issue-create succeeded without a body" };
        }
        return {
          kind: "success",
          meta: {
            externalIssueId: res.body.node_id,
            issueNumber: res.body.number,
            externalUpdatedAt: Date.parse(res.body.updated_at),
            externalAuthor: {
              login: res.body.user.login,
              avatarUrl: res.body.user.avatar_url,
              url: res.body.user.html_url,
            },
          },
        };
      }
      return foldResponse(res); // permanent_fail / retryable (incl. 429 sleep)
    },

    async setIssueState({ projectRef, issueRef, state, stateReason }) {
      const body: Record<string, string> = { state };
      if (state === "closed" && stateReason) body.state_reason = stateReason;
      const res = await gh.request<{ updated_at: string }>({
        method: "PATCH",
        path: `/repos/${projectRef}/issues/${issueRef}`,
        body,
      });
      return foldResponse(res, (b) => ({
        externalUpdatedAt: b?.updated_at ? Date.parse(b.updated_at) : undefined,
      }));
    },

    async setDescription({ projectRef, issueRef, markdown }) {
      const res = await gh.request<unknown>({
        method: "PATCH",
        path: `/repos/${projectRef}/issues/${issueRef}`,
        body: { body: markdown },
      });
      return foldResponse(res);
    },

    async setLabels({ projectRef, issueRef, add, remove }) {
      // POST /labels auto-creates labels missing on the repo.
      if (add.length > 0) {
        const res = await gh.request<unknown>({
          method: "POST",
          path: `/repos/${projectRef}/issues/${issueRef}/labels`,
          body: { labels: add },
        });
        const outcome = await foldResponse(res);
        if (outcome.kind !== "success") return outcome;
      }
      for (const name of remove) {
        const res = await gh.request<unknown>({
          method: "DELETE",
          path: `/repos/${projectRef}/issues/${issueRef}/labels/${encodeURIComponent(name)}`,
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

    async setAssignees({ projectRef, issueRef, add, remove }) {
      if (add.length > 0) {
        const res = await gh.request<unknown>({
          method: "POST",
          path: `/repos/${projectRef}/issues/${issueRef}/assignees`,
          body: { assignees: add },
        });
        const outcome = await foldResponse(res);
        if (outcome.kind !== "success") return outcome;
      }
      if (remove.length > 0) {
        const res = await gh.request<unknown>({
          method: "DELETE",
          path: `/repos/${projectRef}/issues/${issueRef}/assignees`,
          body: { assignees: remove },
        });
        const outcome = await foldResponse(res);
        if (outcome.kind !== "success") return outcome;
      }
      return { kind: "success", meta: {} };
    },

    async createComment({ projectRef, issueRef, body }) {
      const res = await gh.request<{
        id: number;
        node_id: string;
        updated_at: string;
        user: { login: string; avatar_url: string; html_url: string };
      }>({
        method: "POST",
        path: `/repos/${projectRef}/issues/${issueRef}/comments`,
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

    async editComment({ projectRef, externalCommentId, body }) {
      const res = await gh.request<{ updated_at: string }>({
        method: "PATCH",
        path: `/repos/${projectRef}/issues/comments/${externalCommentId}`,
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

    async deleteComment({ projectRef, externalCommentId }) {
      const res = await gh.request<unknown>({
        method: "DELETE",
        path: `/repos/${projectRef}/issues/comments/${externalCommentId}`,
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
 *
 * `credentialRef` is the provider-neutral credential handle the dispatch layer
 * threads (seam 2). GitHub interprets it as the App installation id it mints a
 * short-lived token from.
 */
export function makeGithubGateway(
  credentialRef: string,
): OutboundGateway | null {
  const client = githubClientFromEnv();
  if (!client) return null;
  return buildGithubGateway(client.forInstallation(credentialRef));
}
