import { classifyResponse, type OutboundResponse } from "../core/syncOut";
import type {
  OutboundGateway,
  OutboundOutcome,
  OutboundSuccessMeta,
} from "../core/outboundPort";

/**
 * GitLab implementation of the outbound `OutboundGateway` port — the mirror of
 * `github/outboundGateway.ts`. `buildGitlabGateway` depends only on the
 * token-free `GitlabRequester` surface, so tests inject a fake that returns
 * canned responses (no token, no HTTP); `makeGitlabGateway` is the production
 * entry that binds a real fetch-based requester carrying the stored token.
 *
 * GitLab REST specifics that live behind this boundary:
 *  - the project is addressed by URL-encoded path or numeric id;
 *  - issue state changes use `state_event` (`close`/`reopen`), not `state`, and
 *    GitLab has no completed/not_planned reason;
 *  - labels are a single PUT with comma-joined `add_labels`/`remove_labels`;
 *  - assignees are a full-set `assignee_ids` PUT (Ripple is 1→1, so the desired
 *    single id — or none — comes from the `add` set);
 *  - notes (comments) are addressed by project + issue iid + note id.
 */

const GITLAB_API_BASE = "https://gitlab.com/api/v4";

export interface GitlabResponse<T = unknown> {
  status: number | null;
  body?: T;
  retryAfterMs?: number;
  errorMessage?: string;
}

/** The token-free request surface the gateway drives — the test seam. */
export interface GitlabRequester {
  request<T = unknown>(args: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
  }): Promise<GitlabResponse<T>>;
}

interface GitlabAuthor {
  username: string;
  avatar_url: string;
  web_url: string;
}

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toResponse(res: GitlabResponse): OutboundResponse {
  return {
    status: res.status,
    retryAfterMs: res.retryAfterMs,
    errorMessage: res.errorMessage,
  };
}

function author(a: GitlabAuthor) {
  return { login: a.username, avatarUrl: a.avatar_url, url: a.web_url };
}

/** URL-encode a project path/id for the REST path (`group/project` → `group%2Fproject`). */
function proj(projectRef: string): string {
  return encodeURIComponent(projectRef);
}

/**
 * Classify one response into an `OutboundOutcome`, pre-sleeping on a 429
 * `Retry-After` (Node side) so the orchestrator stays pure. Mirrors the GitHub
 * gateway's `foldResponse`.
 */
async function foldResponse<T>(
  res: GitlabResponse<T>,
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
  return {
    kind: "retryable",
    message: res.errorMessage ?? `HTTP ${res.status}`,
  };
}

export function buildGitlabGateway(gl: GitlabRequester): OutboundGateway {
  return {
    async createIssue({ projectRef, title, body }) {
      const res = await gl.request<{
        id: number;
        iid: number;
        web_url: string;
        updated_at: string;
        author: GitlabAuthor;
      }>({
        method: "POST",
        path: `/projects/${proj(projectRef)}/issues`,
        body: { title, description: body },
      });
      const decision = classifyResponse(toResponse(res));
      if (decision === "success") {
        if (!res.body) {
          return { kind: "retryable", message: "issue-create succeeded without a body" };
        }
        return {
          kind: "success",
          meta: {
            externalIssueId: String(res.body.id),
            issueNumber: res.body.iid,
            externalUpdatedAt: Date.parse(res.body.updated_at),
            externalAuthor: author(res.body.author),
          },
        };
      }
      return foldResponse(res);
    },

    async setIssueState({ projectRef, issueRef, state }) {
      // GitLab toggles state with `state_event`, not a `state` field; it has no
      // completed/not_planned reason, so `stateReason` is intentionally unused.
      const res = await gl.request<{ updated_at: string }>({
        method: "PUT",
        path: `/projects/${proj(projectRef)}/issues/${issueRef}`,
        body: { state_event: state === "closed" ? "close" : "reopen" },
      });
      return foldResponse(res, (b) => ({
        externalUpdatedAt: b?.updated_at ? Date.parse(b.updated_at) : undefined,
      }));
    },

    async setDescription({ projectRef, issueRef, markdown }) {
      const res = await gl.request<unknown>({
        method: "PUT",
        path: `/projects/${proj(projectRef)}/issues/${issueRef}`,
        body: { description: markdown },
      });
      return foldResponse(res);
    },

    async setLabels({ projectRef, issueRef, add, remove }) {
      // GitLab applies adds + removes in a single PUT (comma-joined), unlike
      // GitHub's POST-then-DELETE fan-out.
      const body: Record<string, string> = {};
      if (add.length > 0) body.add_labels = add.join(",");
      if (remove.length > 0) body.remove_labels = remove.join(",");
      const res = await gl.request<unknown>({
        method: "PUT",
        path: `/projects/${proj(projectRef)}/issues/${issueRef}`,
        body,
      });
      return foldResponse(res);
    },

    async setAssignees({ projectRef, issueRef, add }) {
      // Full-set replacement. Ripple is 1→1: `add` carries the desired single
      // assignee id (or is empty to clear). GitLab assigns by numeric user id.
      const res = await gl.request<unknown>({
        method: "PUT",
        path: `/projects/${proj(projectRef)}/issues/${issueRef}`,
        body: { assignee_ids: add.map((id) => Number(id)) },
      });
      return foldResponse(res);
    },

    async createComment({ projectRef, issueRef, body }) {
      const res = await gl.request<{
        id: number;
        updated_at: string;
        author: GitlabAuthor;
      }>({
        method: "POST",
        path: `/projects/${proj(projectRef)}/issues/${issueRef}/notes`,
        body: { body },
      });
      const decision = classifyResponse(toResponse(res));
      if (decision === "success") {
        if (!res.body) {
          return { kind: "retryable", message: "comment-create succeeded without a body" };
        }
        return {
          kind: "success",
          meta: {
            externalCommentId: String(res.body.id),
            externalUpdatedAt: Date.parse(res.body.updated_at),
            externalAuthor: author(res.body.author),
          },
        };
      }
      return foldResponse(res);
    },

    async editComment({ projectRef, issueRef, externalCommentId, body }) {
      const res = await gl.request<{ updated_at: string }>({
        method: "PUT",
        path: `/projects/${proj(projectRef)}/issues/${issueRef}/notes/${externalCommentId}`,
        body: { body },
      });
      return foldResponse(res, (b) => ({
        externalUpdatedAt: b?.updated_at ? Date.parse(b.updated_at) : undefined,
      }));
    },

    async deleteComment({ projectRef, issueRef, externalCommentId }) {
      const res = await gl.request<unknown>({
        method: "DELETE",
        path: `/projects/${proj(projectRef)}/issues/${issueRef}/notes/${externalCommentId}`,
      });
      // 404 means the note was already gone — a benign no-op, recorded as success.
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
 * Production gateway. Builds a fetch-based requester that authenticates with the
 * stored GitLab token (PAT / project / group access token) via the
 * `Authorization: Bearer` header. Returns `null` when no token is configured —
 * the caller records that as a permanent failure (mirrors the GitHub
 * "credentials not configured" affordance).
 */
export function makeGitlabGateway(
  token: string,
  apiBase: string = GITLAB_API_BASE,
): OutboundGateway | null {
  if (!token) return null;
  const requester: GitlabRequester = {
    request: async <T,>(args: {
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      path: string;
      body?: unknown;
    }): Promise<GitlabResponse<T>> => {
      const res = await fetch(`${apiBase}${args.path}`, {
        method: args.method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(args.body !== undefined
          ? { body: JSON.stringify(args.body) }
          : {}),
      });
      const retryAfter = res.headers.get("retry-after");
      let body: T | undefined;
      try {
        body = (await res.json()) as T;
      } catch {
        body = undefined;
      }
      return {
        status: res.status,
        body,
        retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : undefined,
        errorMessage: res.ok ? undefined : `GitLab HTTP ${res.status}`,
      };
    },
  };
  return buildGitlabGateway(requester);
}
