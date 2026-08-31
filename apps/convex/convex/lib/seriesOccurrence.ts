/**
 * Which occurrence of a series a given instant belongs to.
 *
 * A leaf module on purpose: `callSessions` stamps a series call with its
 * occurrence at session creation, and `eventSeries` gates the join on the same
 * answer — putting the answer in either of those files would make the two
 * import each other.
 */
import {
  expandSeries,
  type Occurrence,
  type SeriesDefinition,
  type Weekday,
} from "@ripple/shared/recurrence";

import type { Doc } from "../_generated/dataModel";
import { JOIN_WINDOW_LEAD_MS, JOIN_WINDOW_TAIL_MS } from "./joinWindow";

/**
 * The stored row as the recurrence module wants it. The module owns every
 * question about *when*; the callers own *who may see it* and *what is stored*.
 */
export function toSeriesDefinition(doc: Doc<"eventSeries">): SeriesDefinition {
  return {
    anchor: {
      date: doc.anchorDate,
      time: doc.anchorTime,
      timezone: doc.timezone,
      durationMs: doc.durationMs,
    },
    rule: {
      freq: doc.rule.freq,
      interval: doc.rule.interval,
      weekdays: doc.rule.weekdays as Weekday[] | undefined,
      monthlyMode: doc.rule.monthlyMode,
      end: doc.rule.end,
    },
    excludedStarts: doc.excludedStarts,
  };
}

/**
 * The occurrence whose join window is open at `nowMs`, or null.
 *
 * An occurrence is joinable from `start − lead` to `end + tail`, so the
 * occurrences worth expanding are exactly those touching `[now − tail,
 * now + lead]` — a window a few minutes wide, whatever the rule says. The
 * expansion is therefore bounded by the lead and the tail rather than by the
 * series.
 *
 * Overlapping windows cannot happen for a well-formed rule (two occurrences
 * would have to be within 20 minutes of each other), but if they did the
 * earlier one wins, which is what `expandSeries`' chronological order gives.
 */
export function occurrenceOpenAt(
  doc: Doc<"eventSeries">,
  nowMs: number,
): Occurrence | null {
  const occurrences = expandSeries(toSeriesDefinition(doc), {
    windowStartMs: nowMs - JOIN_WINDOW_TAIL_MS,
    windowEndMs: nowMs + JOIN_WINDOW_LEAD_MS + 1,
  });
  return occurrences[0] ?? null;
}
