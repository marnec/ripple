import { describe, expect, it } from "vitest";
import { classifyResendError } from "../convex/utils/emailErrors";

/**
 * Which Resend failures are worth trying again. Today every failure is one
 * `ConvexError`, which is why nothing could retry: a 429 and a malformed
 * address were indistinguishable to the caller.
 *
 * Pure, so the whole decision is exercised without Convex, a fake Resend or a
 * network — the same shape as `httpAdapter` and `ganttTimeline`.
 */
describe("classifyResendError", () => {
  it("treats rate limiting as retryable", () => {
    expect(classifyResendError("rate_limit_exceeded", 429)).toBe("retryable");
  });

  it("treats Resend's own server errors as retryable", () => {
    expect(classifyResendError("internal_server_error", 500)).toBe("retryable");
    expect(classifyResendError("application_error", 503)).toBe("retryable");
  });

  it("treats a rejected payload as permanent", () => {
    expect(classifyResendError("validation_error", 400)).toBe("permanent");
    expect(classifyResendError("invalid_from_address", 403)).toBe("permanent");
    expect(classifyResendError("missing_required_field", 422)).toBe("permanent");
  });

  it("treats a bad or restricted key as permanent", () => {
    expect(classifyResendError("invalid_api_key", 401)).toBe("permanent");
    expect(classifyResendError("restricted_api_key", 401)).toBe("permanent");
  });

  /**
   * Quota is its own class, and the reason is a scheduling fact rather than a
   * taxonomy preference: the daily allowance resets in hours, while the pool's
   * five attempts are spent within minutes. Retrying cannot outlast it, so the
   * send stops — but "you are out of quota" is a different thing to show an
   * organizer than "that address is invalid", so it does not collapse into
   * `permanent`.
   */
  it("gives quota exhaustion its own class", () => {
    expect(classifyResendError("daily_quota_exceeded", 429)).toBe("quota");
    expect(classifyResendError("monthly_quota_exceeded", 429)).toBe("quota");
  });

  /**
   * An unrecognised code is retried rather than dropped: a new Resend code is
   * far more likely to be a transient condition we have not seen than a
   * permanent one, and the pool bounds the cost of being wrong at five attempts.
   */
  it("retries an unrecognised code", () => {
    expect(classifyResendError("some_future_code", 500)).toBe("retryable");
    expect(classifyResendError(undefined, undefined)).toBe("retryable");
  });

  /**
   * The status code decides when there is no code at all — a bare 4xx is the
   * server telling us the request itself is wrong.
   */
  it("falls back to the status code when no error code is given", () => {
    expect(classifyResendError(undefined, 400)).toBe("permanent");
    expect(classifyResendError(undefined, 429)).toBe("retryable");
    expect(classifyResendError(undefined, 502)).toBe("retryable");
  });
});
