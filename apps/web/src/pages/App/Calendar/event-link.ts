/**
 * What an `/events/:id` URL is asking for, read off its `?on=` parameter.
 *
 * The route serves three things through one path, because an occurrence has no
 * id of its own — its identity is the pair (series, original start), so the
 * series id goes in the path and the coordinate in the query:
 *
 *  - `?on=<originalStartMs>` — one occurrence of the series named in the path.
 *  - no `?on=` — a **bare** link, which is either an event row or a series;
 *    only the server can tell which, so the page asks.
 *  - an `?on=` that is not an instant — a mangled URL, and better said out
 *    loud than quietly resolved to an occurrence nobody linked to.
 *
 * Pure, so the three-way decision is testable without a router.
 */
export type EventLinkView =
  | { kind: "occurrence"; originalStartMs: number }
  | { kind: "bare" }
  | { kind: "invalid" };

export function eventLinkView(on: string | null): EventLinkView {
  if (on === null) return { kind: "bare" };
  // `Number("")` is 0 and `Number(" ")` is 0, either of which would open an
  // occurrence at the epoch rather than admitting the URL is broken.
  if (on.trim() === "") return { kind: "invalid" };
  const originalStartMs = Number(on);
  if (!Number.isFinite(originalStartMs)) return { kind: "invalid" };
  return { kind: "occurrence", originalStartMs };
}
