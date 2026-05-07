import { ConvexError } from "convex/values";

/**
 * Extract a human-readable message from an error caught off a Convex
 * mutation/action. Plain `err.message` includes the Convex framing
 * (e.g. `[CONVEX M(calendarEvents:update)] [Request ID: …] Server Error\n
 * Uncaught ConvexError: Only the organizer can edit this event`) which
 * is fine for logs but unfit for a toast description.
 *
 * Convention used by Ripple's backend: throw `new ConvexError(string)`
 * with the user-facing message. That string lands on the client as
 * `error.data`. For non-ConvexError throwables we fall back to
 * `error.message`, then to a generic copy.
 */
export function getErrorMessage(error: unknown, fallback = "Please try again."): string {
  if (error instanceof ConvexError) return String(error.data);
  if (error instanceof Error) return error.message;
  return fallback;
}
