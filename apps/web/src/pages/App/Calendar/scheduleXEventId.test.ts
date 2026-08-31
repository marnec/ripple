import { describe, expect, it } from "vitest";

import type { Id } from "@convex/_generated/dataModel";
import {
  formatScheduleXEventId,
  parseScheduleXEventId,
} from "./scheduleXEventId";

const SERIES = "s1234567890abcdef" as Id<"eventSeries">;
const EVENT = "e1234567890abcdef" as Id<"calendarEvents">;

describe("occurrences in the schedule-x id space", () => {
  it("round-trips an occurrence through its (series, original start) pair", () => {
    const id = formatScheduleXEventId({
      kind: "occurrence",
      seriesId: SERIES,
      originalStartMs: 1_788_246_000_000,
    });

    expect(parseScheduleXEventId(id)).toEqual({
      kind: "occurrence",
      seriesId: SERIES,
      originalStartMs: 1_788_246_000_000,
    });
  });

  it("keeps two occurrences of one series apart", () => {
    const first = formatScheduleXEventId({
      kind: "occurrence",
      seriesId: SERIES,
      originalStartMs: 1,
    });
    const second = formatScheduleXEventId({
      kind: "occurrence",
      seriesId: SERIES,
      originalStartMs: 2,
    });
    expect(first).not.toBe(second);
  });

  it("does not mistake an occurrence for a one-off event", () => {
    // An override is a `calendarEvents` row and still travels as an event; a
    // computed occurrence has no row and must never be routed to one.
    const eventId = formatScheduleXEventId({ kind: "event", id: EVENT });
    expect(parseScheduleXEventId(eventId)).toEqual({ kind: "event", id: EVENT });

    const occurrence = formatScheduleXEventId({
      kind: "occurrence",
      seriesId: SERIES,
      originalStartMs: 5,
    });
    expect(parseScheduleXEventId(occurrence)?.kind).toBe("occurrence");
  });

  it("returns null for a malformed occurrence rather than half of one", () => {
    expect(parseScheduleXEventId("occurrence-no-separator")).toBeNull();
    expect(parseScheduleXEventId(`occurrence-${SERIES}@notanumber`)).toBeNull();
  });
});
