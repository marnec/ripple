/**
 * What an `@event` mention chip points at, and where following it goes.
 *
 * One inline-content type — `eventMention` — carries two kinds of target: a
 * one-off event's row, and a **series**. They cannot be one id: an event id and
 * a series id live in different tables, and every query that reads one refuses
 * the other. So the chip carries whichever it was given and this module is the
 * single place that decides which it is, rather than each of the four render
 * sites re-deriving it from `props.eventId ?? props.seriesId`.
 *
 * Pure — no React, no Convex — so both the decision and the URL are testable
 * without mounting an editor.
 */
import type { Id } from "@convex/_generated/dataModel";

export type EventMentionTarget =
  | { kind: "event"; eventId: Id<"calendarEvents"> }
  | { kind: "series"; seriesId: Id<"eventSeries"> }
  | { kind: "unknown" };

/**
 * BlockNote props are user-controlled JSON, and both ids default to an empty
 * string when a chip is inserted without one — hence the emptiness checks
 * rather than a plain presence test.
 */
export function eventMentionTarget(props: {
  eventId?: string | null;
  seriesId?: string | null;
}): EventMentionTarget {
  if (props.seriesId) {
    return { kind: "series", seriesId: props.seriesId as Id<"eventSeries"> };
  }
  if (props.eventId) {
    return { kind: "event", eventId: props.eventId as Id<"calendarEvents"> };
  }
  return { kind: "unknown" };
}

/**
 * Where the chip navigates. A series link is deliberately **bare** — no
 * `?on=` coordinate — because a mention is about the pattern; the bare link
 * resolves to the next occurrence from whenever it happens to be followed,
 * which is what keeps an old message from becoming a dead page.
 */
export function eventMentionHref(
  workspaceId: Id<"workspaces">,
  target: EventMentionTarget,
): string | null {
  switch (target.kind) {
    case "event":
      return `/workspaces/${workspaceId}/events/${target.eventId}`;
    case "series":
      return `/workspaces/${workspaceId}/events/${target.seriesId}`;
    case "unknown":
      return null;
  }
}
