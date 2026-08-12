/**
 * Which Resend failures are worth trying again.
 *
 * Every calendar send used to raise one `ConvexError` regardless of cause,
 * which is precisely why none of them could be retried: a 429 and a malformed
 * address arrived at the caller as the same thing. Splitting them is what lets
 * the workpool back off on the first and stop dead on the second.
 *
 * Pure — no Convex, no Resend client, no network — so the whole decision is a
 * table-driven unit test (`tests/emailErrors.test.ts`), the same way
 * `httpAdapter` and `ganttTimeline` keep their logic reachable.
 */

export type ResendFailureClass =
  /** Transient. Throw, and let the pool back off and try again. */
  | "retryable"
  /** The request itself is wrong. Retrying reproduces it exactly. */
  | "permanent"
  /**
   * The allowance is spent. Its own class rather than a flavour of `permanent`
   * because the cause is temporal — the daily window resets in hours, while the
   * pool's attempts are spent in minutes, so retrying cannot outlast it — and
   * because "out of quota" is a different thing to show an organizer than
   * "that address is invalid".
   */
  | "quota";

/**
 * Codes Resend returns for a request it will reject identically next time.
 * Transcribed from the SDK's `RESEND_ERROR_CODE_KEY` union, which it does not
 * export — so these are unchecked strings and a typo would fall through to
 * `retryable` rather than failing to compile. That fallthrough is the safe
 * direction (five wasted attempts, not a dropped email), but it is why the
 * classification table has a test per branch.
 */
const PERMANENT_CODES = new Set([
  "validation_error",
  "missing_required_field",
  "invalid_parameter",
  "invalid_attachment",
  "invalid_from_address",
  "invalid_access",
  "invalid_api_key",
  "restricted_api_key",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "invalid_region",
  "not_found",
  "method_not_allowed",
  "security_error",
]);

const QUOTA_CODES = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);

export function classifyResendError(
  code: string | undefined,
  status: number | undefined,
): ResendFailureClass {
  if (code !== undefined) {
    if (QUOTA_CODES.has(code)) return "quota";
    if (PERMANENT_CODES.has(code)) return "permanent";
    // Includes `rate_limit_exceeded`, `internal_server_error`,
    // `application_error` — and anything Resend adds later. An unknown code is
    // far likelier to be a condition we have not seen than a permanent
    // rejection, and the pool bounds the cost of guessing wrong.
    return "retryable";
  }

  // No code at all: the status is all we have. A 4xx that is not 408/429 is the
  // server saying the request is wrong; everything else gets another attempt.
  if (status !== undefined && status >= 400 && status < 500) {
    if (status === 408 || status === 429) return "retryable";
    return "permanent";
  }
  return "retryable";
}
