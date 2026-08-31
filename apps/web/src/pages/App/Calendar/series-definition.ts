/**
 * The stored series row as the recurrence module wants it — the browser half
 * of the backend's `toSeriesDefinition` (`convex/lib/seriesOccurrence.ts`).
 *
 * The recurrence module is browser-safe on purpose, so every page that has a
 * series in hand answers its own "when does this next meet" and "how many are
 * left" rather than asking the server for numbers it would have to recompute
 * per viewer. One conversion, here, so the two halves cannot drift.
 */
import type {
  RecurrenceRule,
  SeriesDefinition,
  Weekday,
} from "@ripple/shared/recurrence";

/**
 * The shape `api.eventSeries.get` returns, narrowed to what timing needs.
 * `weekdays` is `string[]` rather than `Weekday[]`: Convex validators have no
 * enum, so the wire shape is wider than the module's — which is the one thing
 * this conversion exists to reconcile.
 */
export type StoredSeries = {
  anchorDate: string;
  anchorTime: string;
  timezone: string;
  durationMs: number;
  rule: Omit<RecurrenceRule, "weekdays"> & { weekdays?: string[] };
  excludedStarts?: number[];
};

export function toSeriesDefinition(series: StoredSeries): SeriesDefinition {
  return {
    anchor: {
      date: series.anchorDate,
      time: series.anchorTime,
      timezone: series.timezone,
      durationMs: series.durationMs,
    },
    rule: {
      ...series.rule,
      // `weekdays` is `string[]` over the wire — Convex validators have no
      // enum, and the union lives in the recurrence module.
      weekdays: series.rule.weekdays as Weekday[] | undefined,
    },
    excludedStarts: series.excludedStarts,
  };
}
