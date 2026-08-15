/**
 * Provenance markers embedded in the body of every Ripple-originated issue and
 * comment.
 *
 * Two namespaces, two jobs.
 *
 * `ripple-task:` — the inbound webhook handler reads it to recognize the
 * bounce-back of a write we just performed. Without it, an OAuth-impersonating
 * install (e.g. GitLab) can't tell its own outbound write apart from a human
 * creating the same issue, because both events are authored by the same user.
 * It is also what `findIssueByRippleTask` matches on, so a retried
 * `createIssue` converges instead of minting a duplicate.
 *
 * `ripple-comment:` — the same convergence guarantee for comment-create, which
 * is the other non-idempotent POST in the outbound surface. A comment POST that
 * commits but loses its response is retried by the action-retrier, and the
 * duplicate it would post is on the customer's issue tracker and beyond
 * Ripple's reach: only the last attempt's id reaches
 * `taskCommentIntegrationLinks`, so the earlier ones have no link row and are
 * invisible to the edit and delete pushes.
 *
 * Deliberately a separate namespace rather than a reused `ripple-task:`: a
 * comment hangs off an issue that already carries a task marker, and one
 * namespace would let `findIssueByRippleTask`'s body scan match comment bodies.
 *
 * Each marker is an HTML comment so it doesn't render in either provider's
 * view; GitHub and GitLab both preserve it verbatim in the raw body shipped via
 * REST + webhooks. Placed on its own line at the very end so humans editing the
 * body never see it inline and don't accidentally remove it. Strip it before
 * piping a body back into Ripple (description seed, comment seed) so
 * round-trips don't pollute what the user reads.
 */
import type { Id } from "../../_generated/dataModel";

const TASK_PREFIX = "ripple-task:";
const COMMENT_PREFIX = "ripple-comment:";

// Match a marker anywhere in the body. Whitespace inside the comment is
// tolerated so a user (or a markdown formatter) that adds spaces around the
// id doesn't break extraction. The id itself is the Convex 1-32 alphanumeric
// id format; intentionally tight so unrelated HTML comments don't false-match.
const TASK_RE = /<!--\s*ripple-task:\s*([a-z0-9]{1,40})\s*-->/i;
const COMMENT_RE = /<!--\s*ripple-comment:\s*([a-z0-9]{1,40})\s*-->/i;

/** Trailing-marker form, for stripping on the way back into Ripple. */
const TRAILING_TASK_RE = /\n*<!--\s*ripple-task:\s*[a-z0-9]{1,40}\s*-->\s*$/i;
const TRAILING_COMMENT_RE =
  /\n*<!--\s*ripple-comment:\s*[a-z0-9]{1,40}\s*-->\s*$/i;

function append(body: string, prefix: string, id: string, existing: string | null): string {
  if (existing === id) return body;
  if (existing !== null) {
    throw new Error(
      `Body already carries a ${prefix} marker for ${existing}; refusing to overwrite with ${id}`,
    );
  }
  const marker = `<!-- ${prefix} ${id} -->`;
  // Trim trailing whitespace so we always end with exactly one blank line
  // before the marker — keeps diffs clean if the body is edited later.
  const trimmed = body.replace(/\s+$/, "");
  return trimmed.length === 0 ? marker : `${trimmed}\n\n${marker}`;
}

/**
 * Append the task marker to an issue body so the inbound webhook can attribute
 * the bounce-back to its originating task. Idempotent: calling twice with the
 * same id leaves the existing marker in place. Calling with a different id
 * is a programmer error — we throw rather than silently overwrite.
 */
export function appendRippleTaskMarker(
  body: string,
  taskId: Id<"tasks">,
): string {
  return append(body, TASK_PREFIX, taskId, extractRippleTaskId(body));
}

/**
 * Append the comment marker to an outbound comment body, so a retried
 * comment-create can find the comment its lost attempt already posted.
 * Same idempotence and same refusal-to-overwrite as the task marker.
 */
export function appendRippleCommentMarker(
  body: string,
  commentId: Id<"taskComments">,
): string {
  return append(body, COMMENT_PREFIX, commentId, extractRippleCommentId(body));
}

/**
 * Extract a Ripple task id from an issue/comment body, or null if absent.
 * Returns the raw id string; callers cast to `Id<"tasks">` only after
 * verifying the id resolves to a real task in the right project (since the
 * marker is user-readable and could be spoofed by anyone editing the body).
 */
export function extractRippleTaskId(
  body: string | undefined | null,
): string | null {
  if (!body) return null;
  const match = body.match(TASK_RE);
  return match ? match[1] : null;
}

/**
 * Extract a Ripple comment id from a provider comment body, or null if absent.
 * Same spoofability caveat as `extractRippleTaskId` — but the only consumer is
 * the create precheck, where a spoofed marker costs a skipped POST, not a
 * misattributed row.
 */
export function extractRippleCommentId(
  body: string | undefined | null,
): string | null {
  if (!body) return null;
  const match = body.match(COMMENT_RE);
  return match ? match[1] : null;
}

/**
 * Remove the task marker from a body before seeding it into Ripple's BlockNote
 * document. We never want the marker visible in the task description; it's
 * provider-side metadata, not human content. Also strips the leading blank
 * line we inserted with it so the body doesn't grow trailing whitespace each
 * round trip.
 */
export function stripRippleMarker(body: string): string {
  return body.replace(TRAILING_TASK_RE, "");
}

/**
 * Remove either marker from the end of a body.
 *
 * The inbound comment path needs this rather than `stripRippleMarker`: a human
 * editing Ripple's mirrored comment on the provider sends the whole raw body
 * back, marker included, and `comment.edited` would otherwise store it and seed
 * it into the BlockNote comment the user reads.
 */
export function stripRippleMarkers(body: string): string {
  return body.replace(TRAILING_COMMENT_RE, "").replace(TRAILING_TASK_RE, "");
}
