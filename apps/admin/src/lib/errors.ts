/**
 * Extract a human-readable message from a thrown error.
 *
 * A `ConvexError` thrown server-side arrives on the client with its payload on
 * `err.data` (for `new ConvexError("msg")` that's the string), while `err.message`
 * is a multi-line hybrid stacktrace like:
 *   [CONVEX M(admin/users:deleteAccount)] [Request ID: …] Server Error
 *   Uncaught ConvexError: User owns 2 workspace(s) …
 * So we read `data` first and only fall back to `message` for non-Convex errors.
 */
export function errorMessage(err: unknown, fallback = "Action failed."): string {
  if (err && typeof err === "object" && "data" in err) {
    const data: unknown = err.data;
    if (typeof data === "string" && data.trim()) return data;
  }
  return err instanceof Error && err.message ? err.message.split("\n")[0] : fallback;
}
