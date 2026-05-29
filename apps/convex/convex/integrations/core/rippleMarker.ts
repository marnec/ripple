/**
 * Provenance marker embedded in the body of every Ripple-originated issue
 * (and, later, comments). The inbound webhook handler reads the marker to
 * recognize the bounce-back of a write we just performed — without it, an
 * OAuth-impersonating install (e.g. GitLab) can't tell its own outbound write
 * apart from a human creating the same issue, because both events are
 * authored by the same user.
 *
 * The marker is an HTML comment so it doesn't render in either provider's
 * issue view; GitHub and GitLab both preserve it verbatim in the raw body
 * shipped via REST + webhooks. Placed on its own line at the very end so
 * humans editing the body never see it inline and don't accidentally remove
 * it. Strip it before piping the body back into Ripple (description seed) so
 * round-trips don't pollute the task's BlockNote doc.
 */
import type { Id } from "../../_generated/dataModel";

const MARKER_PREFIX = "ripple-task:";

// Match the marker anywhere in the body. Whitespace inside the comment is
// tolerated so a user (or a markdown formatter) that adds spaces around the
// id doesn't break extraction. The id itself is the Convex 1-32 alphanumeric
// id format; intentionally tight so unrelated HTML comments don't false-match.
const MARKER_RE = /<!--\s*ripple-task:\s*([a-z0-9]{1,40})\s*-->/i;

/**
 * Append the marker to an issue body so the inbound webhook can attribute the
 * bounce-back to its originating task. Idempotent: calling twice with the
 * same id leaves the existing marker in place. Calling with a different id
 * is a programmer error — we throw rather than silently overwrite.
 */
export function appendRippleTaskMarker(
  body: string,
  taskId: Id<"tasks">,
): string {
  const existing = extractRippleTaskId(body);
  if (existing === taskId) return body;
  if (existing !== null) {
    throw new Error(
      `Body already carries a ripple-task marker for ${existing}; refusing to overwrite with ${taskId}`,
    );
  }
  const marker = `<!-- ${MARKER_PREFIX} ${taskId} -->`;
  // Trim trailing whitespace so we always end with exactly one blank line
  // before the marker — keeps diffs clean if the body is edited later.
  const trimmed = body.replace(/\s+$/, "");
  return trimmed.length === 0 ? marker : `${trimmed}\n\n${marker}`;
}

/**
 * Extract a Ripple task id from an issue/comment body, or null if absent.
 * Returns the raw id string; callers cast to `Id<"tasks">` only after
 * verifying the id resolves to a real task in the right project (since the
 * marker is user-readable and could be spoofed by anyone editing the body).
 */
export function extractRippleTaskId(body: string | undefined | null): string | null {
  if (!body) return null;
  const match = body.match(MARKER_RE);
  return match ? match[1] : null;
}

/**
 * Remove the marker from a body before seeding it into Ripple's BlockNote
 * document. We never want the marker visible in the task description; it's
 * provider-side metadata, not human content. Also strips the leading blank
 * line we inserted with it so the body doesn't grow trailing whitespace each
 * round trip.
 */
export function stripRippleMarker(body: string): string {
  return body.replace(/\n*<!--\s*ripple-task:\s*[a-z0-9]{1,40}\s*-->\s*$/i, "");
}
