import { describe, expect, it } from "vitest";
import type { SeriesDefinition } from "@ripple/shared/recurrence";

import { describeOccurrenceInSeries } from "./occurrence-summary";

/** 09:00–09:30 on Tuesday 1 September 2026, Rome. */
const ROME_TUESDAY_MORNING = {
  date: "2026-09-01",
  time: "09:00",
  timezone: "Europe/Rome",
  durationMs: 30 * 60 * 1000,
};

const FIRST_TUESDAY = Date.parse("2026-09-01T07:00:00Z");
const LAST_OF_FOUR = Date.parse("2026-09-22T07:00:00Z");

const fourTuesdays: SeriesDefinition = {
  anchor: ROME_TUESDAY_MORNING,
  rule: {
    freq: "weekly",
    interval: 1,
    weekdays: ["tuesday"],
    end: { kind: "afterCount", count: 4 },
  },
};

describe("what an occurrence says about the series it belongs to", () => {
  it("names the pattern and how many are left after this one", () => {
    expect(describeOccurrenceInSeries(fourTuesdays, FIRST_TUESDAY)).toBe(
      "Repeats every week on Tuesday · 3 more after this one",
    );
  });

  it("says 'one more' rather than '1 more'", () => {
    expect(
      describeOccurrenceInSeries(fourTuesdays, Date.parse("2026-09-15T07:00:00Z")),
    ).toBe("Repeats every week on Tuesday · one more after this one");
  });

  it("says so plainly when this is the last one", () => {
    expect(describeOccurrenceInSeries(fourTuesdays, LAST_OF_FOUR)).toBe(
      "Repeats every week on Tuesday · this is the last one",
    );
  });

  it("gives no number for an open-ended series", () => {
    // Nothing renews it and nothing ever asks the organizer to, so the
    // horizon's worth would be a number nobody chose.
    const forever: SeriesDefinition = {
      anchor: ROME_TUESDAY_MORNING,
      rule: {
        freq: "weekly",
        interval: 1,
        weekdays: ["tuesday"],
        end: { kind: "never" },
      },
    };
    expect(describeOccurrenceInSeries(forever, FIRST_TUESDAY)).toBe(
      "Repeats every week on Tuesday · no end date",
    );
  });

  it("does not count a cancelled occurrence among those left", () => {
    const withSkip: SeriesDefinition = {
      ...fourTuesdays,
      excludedStarts: [Date.parse("2026-09-15T07:00:00Z")],
    };
    expect(describeOccurrenceInSeries(withSkip, FIRST_TUESDAY)).toBe(
      "Repeats every week on Tuesday · 2 more after this one",
    );
  });
});
