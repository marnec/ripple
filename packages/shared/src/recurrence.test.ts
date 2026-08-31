import { describe, expect, it } from "vitest";

import {
  RECURRENCE_LIMITS,
  RecurrenceLimitError,
  countOccurrences,
  expandSeries,
  firstOccurrence,
  lastOccurrenceEndsAt,
  nextOccurrenceFrom,
  reachOfEdit,
  remainingOccurrences,
  affectsOnlyThePast,
  seriesEndsAt,
  splitSeries,
  toExDate,
  toRRule,
  validateSeries,
  type SeriesDefinition,
} from "./recurrence";

/** Occurrence starts as ISO UTC instants — readable in a failure message. */
function startsOf(
  series: SeriesDefinition,
  windowStart: string,
  windowEnd: string,
): string[] {
  return expandSeries(series, {
    windowStartMs: Date.parse(windowStart),
    windowEndMs: Date.parse(windowEnd),
  }).map((o) => new Date(o.startsAt).toISOString());
}

/** 09:00–09:30 on Tuesday 1 September 2026, Rome. Rome is UTC+2 that month. */
const ROME_TUESDAY_MORNING = {
  date: "2026-09-01",
  time: "09:00",
  timezone: "Europe/Rome",
  durationMs: 30 * 60 * 1000,
};

describe("expandSeries", () => {
  it("yields a weekly series' occurrence on every matching weekday in the window", () => {
    const series: SeriesDefinition = {
      anchor: ROME_TUESDAY_MORNING,
      rule: {
        freq: "weekly",
        interval: 1,
        weekdays: ["tuesday"],
        end: { kind: "never" },
      },
    };

    expect(startsOf(series, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z")).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-08T07:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
      "2026-09-22T07:00:00.000Z",
      "2026-09-29T07:00:00.000Z",
    ]);
  });
});

describe("a series' end", () => {
  const weeklyEnding = (end: SeriesDefinition["rule"]["end"]): SeriesDefinition => ({
    anchor: ROME_TUESDAY_MORNING,
    rule: { freq: "weekly", interval: 1, weekdays: ["tuesday"], end },
  });

  it("stops after the end date, inclusive of an occurrence falling on it", () => {
    expect(
      startsOf(
        weeklyEnding({ kind: "onDate", date: "2026-09-15" }),
        "2026-09-01T00:00:00Z",
        "2026-10-01T00:00:00Z",
      ),
    ).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-08T07:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
    ]);
  });

  it("stops after the counted occurrence, counting from the anchor and not from the window", () => {
    const series = weeklyEnding({ kind: "afterCount", count: 3 });

    expect(startsOf(series, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z")).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-08T07:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
    ]);
    // A window opened after the count is exhausted sees nothing, even though
    // the rule would happily place occurrences there.
    expect(startsOf(series, "2026-09-20T00:00:00Z", "2026-10-01T00:00:00Z")).toEqual([]);
  });
});

describe("countOccurrences", () => {
  const weeklyEnding = (end: SeriesDefinition["rule"]["end"]): SeriesDefinition => ({
    anchor: ROME_TUESDAY_MORNING,
    rule: { freq: "weekly", interval: 1, weekdays: ["tuesday"], end },
  });

  it("counts what a rule ending on a date will produce, over its whole life", () => {
    // 1, 8, 15, 22 and 29 September — the window a calendar happens to be
    // showing has nothing to do with it.
    expect(countOccurrences(weeklyEnding({ kind: "onDate", date: "2026-09-30" }))).toBe(
      5,
    );
  });

  it("counts a rule that ends after a number of occurrences", () => {
    expect(countOccurrences(weeklyEnding({ kind: "afterCount", count: 12 }))).toBe(12);
  });

  it("gives an open-ended rule no count at all", () => {
    expect(countOccurrences(weeklyEnding({ kind: "never" }))).toBeNull();
  });

  it("refuses a count no series could ever run to, rather than walking it", () => {
    // A hundred million Tuesdays is two million years. Answering it by
    // counting them is not slow, it is a hang — and the organizer typed it
    // into a number field by accident, so the answer has to come back.
    const absurd = weeklyEnding({ kind: "afterCount", count: 100_000_000 });

    const verdict = validateSeries(absurd);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe("seriesSpanYears");
  });

  it("does not count occurrences the organizer cancelled", () => {
    expect(
      countOccurrences({
        ...weeklyEnding({ kind: "afterCount", count: 5 }),
        // The 8th and the 15th, skipped.
        excludedStarts: [
          Date.parse("2026-09-08T07:00:00Z"),
          Date.parse("2026-09-15T07:00:00Z"),
        ],
      }),
    ).toBe(3);
  });
});

describe("wall-clock time across daylight saving", () => {
  it("keeps a northern-hemisphere series at its local time when the clocks go back", () => {
    // Rome leaves CEST (UTC+2) for CET (UTC+1) on Sunday 25 October 2026.
    // 09:00 local is 07:00Z before it and 08:00Z after it — the wall clock,
    // not the instant, is what stays put.
    expect(
      startsOf(
        {
          anchor: ROME_TUESDAY_MORNING,
          rule: {
            freq: "weekly",
            interval: 1,
            weekdays: ["tuesday"],
            end: { kind: "never" },
          },
        },
        "2026-10-19T00:00:00Z",
        "2026-11-01T00:00:00Z",
      ),
    ).toEqual(["2026-10-20T07:00:00.000Z", "2026-10-27T08:00:00.000Z"]);
  });

  it("keeps a southern-hemisphere series at its local time when the clocks go forward", () => {
    // Sydney enters AEDT (UTC+11) from AEST (UTC+10) on Sunday 4 October 2026.
    expect(
      startsOf(
        {
          anchor: {
            date: "2026-09-30",
            time: "09:00",
            timezone: "Australia/Sydney",
            durationMs: 30 * 60 * 1000,
          },
          rule: {
            freq: "weekly",
            interval: 1,
            weekdays: ["wednesday"],
            end: { kind: "never" },
          },
        },
        "2026-09-28T00:00:00Z",
        "2026-10-08T00:00:00Z",
      ),
    ).toEqual(["2026-09-29T23:00:00.000Z", "2026-10-06T22:00:00.000Z"]);
  });

  it("pushes an anchor time forward when the clocks swallow it", () => {
    // Rome jumps 02:00 → 03:00 on Sunday 29 March 2026, so 02:30 never
    // happens. `compatible` disambiguation pushes into the gap: 03:30 local,
    // which is 01:30Z at the new UTC+2 offset.
    expect(
      startsOf(
        {
          anchor: {
            date: "2026-03-29",
            time: "02:30",
            timezone: "Europe/Rome",
            durationMs: 30 * 60 * 1000,
          },
          rule: {
            freq: "weekly",
            interval: 1,
            weekdays: ["sunday"],
            end: { kind: "afterCount", count: 1 },
          },
        },
        "2026-03-29T00:00:00Z",
        "2026-03-30T00:00:00Z",
      ),
    ).toEqual(["2026-03-29T01:30:00.000Z"]);
  });

  it("takes the earlier of an anchor time that happens twice", () => {
    // Rome repeats 02:00–03:00 on Sunday 25 October 2026. 02:30 exists at
    // UTC+2 (00:30Z) and again at UTC+1 (01:30Z); `compatible` takes the first.
    expect(
      startsOf(
        {
          anchor: {
            date: "2026-10-25",
            time: "02:30",
            timezone: "Europe/Rome",
            durationMs: 30 * 60 * 1000,
          },
          rule: {
            freq: "weekly",
            interval: 1,
            weekdays: ["sunday"],
            end: { kind: "afterCount", count: 1 },
          },
        },
        "2026-10-25T00:00:00Z",
        "2026-10-26T00:00:00Z",
      ),
    ).toEqual(["2026-10-25T00:30:00.000Z"]);
  });
});

describe("daily and yearly frequencies", () => {
  it("places a daily series every interval days from the anchor", () => {
    expect(
      startsOf(
        {
          anchor: ROME_TUESDAY_MORNING,
          rule: { freq: "daily", interval: 3, end: { kind: "never" } },
        },
        "2026-09-01T00:00:00Z",
        "2026-09-15T00:00:00Z",
      ),
    ).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-04T07:00:00.000Z",
      "2026-09-07T07:00:00.000Z",
      "2026-09-10T07:00:00.000Z",
      "2026-09-13T07:00:00.000Z",
    ]);
  });

  it("places a yearly series on the same local date each year", () => {
    expect(
      startsOf(
        {
          anchor: ROME_TUESDAY_MORNING,
          rule: { freq: "yearly", interval: 1, end: { kind: "never" } },
        },
        "2026-08-01T00:00:00Z",
        "2029-01-01T00:00:00Z",
      ),
    ).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2027-09-01T07:00:00.000Z",
      "2028-09-01T07:00:00.000Z",
    ]);
  });

  it("skips years that do not have the anchor's date at all", () => {
    // A 29 February series happens in leap years and nowhere else — it does
    // not silently slide to the 28th. Rome is on CET (UTC+1) in February.
    expect(
      startsOf(
        {
          anchor: {
            date: "2028-02-29",
            time: "09:00",
            timezone: "Europe/Rome",
            durationMs: 30 * 60 * 1000,
          },
          rule: { freq: "yearly", interval: 1, end: { kind: "never" } },
        },
        "2028-01-01T00:00:00Z",
        "2033-01-01T00:00:00Z",
      ),
    ).toEqual(["2028-02-29T08:00:00.000Z", "2032-02-29T08:00:00.000Z"]);
  });
});

describe("monthly frequency", () => {
  it("skips months that have no such day rather than sliding to the last one", () => {
    // A 31st-of-the-month series happens in January, March, May and July —
    // never on 28 February. Rome is CET (UTC+1) in January and February and
    // CEST (UTC+2) from 29 March.
    expect(
      startsOf(
        {
          anchor: {
            date: "2026-01-31",
            time: "09:00",
            timezone: "Europe/Rome",
            durationMs: 30 * 60 * 1000,
          },
          rule: {
            freq: "monthly",
            interval: 1,
            monthlyMode: "dayOfMonth",
            end: { kind: "never" },
          },
        },
        "2026-01-01T00:00:00Z",
        "2026-08-01T00:00:00Z",
      ),
    ).toEqual([
      "2026-01-31T08:00:00.000Z",
      "2026-03-31T07:00:00.000Z",
      "2026-05-31T07:00:00.000Z",
      "2026-07-31T07:00:00.000Z",
    ]);
  });

  it("places an nth-weekday series on that weekday each month", () => {
    // The anchor is the first Tuesday of September 2026, so the series is
    // "the first Tuesday of the month".
    expect(
      startsOf(
        {
          anchor: ROME_TUESDAY_MORNING,
          rule: {
            freq: "monthly",
            interval: 1,
            monthlyMode: "nthWeekday",
            end: { kind: "never" },
          },
        },
        "2026-09-01T00:00:00Z",
        "2026-12-31T00:00:00Z",
      ),
    ).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-10-06T07:00:00.000Z",
      "2026-11-03T08:00:00.000Z",
      "2026-12-01T08:00:00.000Z",
    ]);
  });

  it("skips months without a fifth weekday", () => {
    // Anchored on the fifth Tuesday of September 2026. October, November and
    // January have only four Tuesdays; December has five.
    expect(
      startsOf(
        {
          anchor: {
            date: "2026-09-29",
            time: "09:00",
            timezone: "Europe/Rome",
            durationMs: 30 * 60 * 1000,
          },
          rule: {
            freq: "monthly",
            interval: 1,
            monthlyMode: "nthWeekday",
            end: { kind: "never" },
          },
        },
        "2026-09-01T00:00:00Z",
        "2027-02-01T00:00:00Z",
      ),
    ).toEqual(["2026-09-29T07:00:00.000Z", "2026-12-29T08:00:00.000Z"]);
  });
});

describe("starts that are handled elsewhere", () => {
  const weeklyTuesdays: SeriesDefinition = {
    anchor: ROME_TUESDAY_MORNING,
    rule: {
      freq: "weekly",
      interval: 1,
      weekdays: ["tuesday"],
      end: { kind: "never" },
    },
  };

  it("drops a cancelled occurrence and leaves the rest of the series standing", () => {
    expect(
      startsOf(
        { ...weeklyTuesdays, excludedStarts: [Date.parse("2026-09-08T07:00:00Z")] },
        "2026-09-01T00:00:00Z",
        "2026-10-01T00:00:00Z",
      ),
    ).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
      "2026-09-22T07:00:00.000Z",
      "2026-09-29T07:00:00.000Z",
    ]);
  });

  it("drops an overridden occurrence, because the override's own row carries it", () => {
    // An override is a stored row that the calendar's existing scan already
    // returns at its new time. Expanding the rule here too would show the
    // meeting twice — once where it was moved to, once where it used to be.
    expect(
      startsOf(
        { ...weeklyTuesdays, overriddenStarts: [Date.parse("2026-09-22T07:00:00Z")] },
        "2026-09-01T00:00:00Z",
        "2026-10-01T00:00:00Z",
      ),
    ).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-08T07:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
      "2026-09-29T07:00:00.000Z",
    ]);
  });

  it("ignores an overridden start that names no occurrence", () => {
    // Left behind by a rule edit that moved the series off that instant. The
    // override row itself is reset by the edit; a stale start here must not
    // silently swallow a neighbouring occurrence.
    expect(
      startsOf(
        { ...weeklyTuesdays, overriddenStarts: [Date.parse("2026-09-09T07:00:00Z")] },
        "2026-09-01T00:00:00Z",
        "2026-09-16T00:00:00Z",
      ),
    ).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-08T07:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
    ]);
  });

  it("ignores an excluded start that names no occurrence", () => {
    // Left behind by a rule edit that moved the series off that instant.
    expect(
      startsOf(
        { ...weeklyTuesdays, excludedStarts: [Date.parse("2026-09-09T07:00:00Z")] },
        "2026-09-01T00:00:00Z",
        "2026-09-16T00:00:00Z",
      ),
    ).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-08T07:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
    ]);
  });
});

describe("limits", () => {
  it("refuses a window that would yield more occurrences than the cap, rather than truncating", () => {
    // A short calendar is indistinguishable from a quiet one, so a window too
    // dense to serve is an error the caller must see — never a silent trim.
    const daily: SeriesDefinition = {
      anchor: ROME_TUESDAY_MORNING,
      rule: { freq: "daily", interval: 1, end: { kind: "never" } },
    };

    expect(() =>
      startsOf(daily, "2026-09-01T00:00:00Z", "2029-09-01T00:00:00Z"),
    ).toThrow(RecurrenceLimitError);

    expect(
      startsOf(daily, "2026-09-01T00:00:00Z", "2027-08-01T00:00:00Z"),
    ).toHaveLength(334);
  });
});

describe("seriesEndsAt", () => {
  const from = Date.parse("2026-09-01T00:00:00Z");

  it("ends a counted series after its last occurrence", () => {
    expect(
      seriesEndsAt(
        {
          anchor: ROME_TUESDAY_MORNING,
          rule: {
            freq: "weekly",
            interval: 1,
            weekdays: ["tuesday"],
            end: { kind: "afterCount", count: 3 },
          },
        },
        from,
      ),
    ).toBe(Date.parse("2026-09-15T07:30:00Z"));
  });

  it("ends an open-ended series at the horizon, so no read is unbounded", () => {
    // "Never" is a statement about the rule, not a licence for an unbounded
    // read — the horizon is what makes an open-ended series answerable.
    expect(
      seriesEndsAt(
        {
          anchor: ROME_TUESDAY_MORNING,
          rule: {
            freq: "weekly",
            interval: 1,
            weekdays: ["tuesday"],
            end: { kind: "never" },
          },
        },
        from,
      ),
    ).toBe(Date.parse("2028-09-01T00:00:00Z"));
  });

  it("reports a bounded rule's true end, unclamped by the horizon", () => {
    // The stored `activeUntil` uses this: a series ending in five years must
    // not be recorded as ending at the two-year horizon, or the range read
    // would drop it three years early.
    expect(
      lastOccurrenceEndsAt({
        anchor: ROME_TUESDAY_MORNING,
        rule: {
          freq: "yearly",
          interval: 1,
          end: { kind: "onDate", date: "2031-09-02" },
        },
      }),
    ).toBe(Date.parse("2031-09-01T07:30:00Z"));

    expect(
      lastOccurrenceEndsAt({
        anchor: ROME_TUESDAY_MORNING,
        rule: {
          freq: "weekly",
          interval: 1,
          weekdays: ["tuesday"],
          end: { kind: "never" },
        },
      }),
    ).toBeNull();
  });

  it("puts the horizon two years out", () => {
    expect(RECURRENCE_LIMITS.horizonMonths).toBe(24);
  });
});

describe("validateSeries", () => {
  const withRule = (rule: SeriesDefinition["rule"]): SeriesDefinition => ({
    anchor: ROME_TUESDAY_MORNING,
    rule,
  });

  const weekly = (end: SeriesDefinition["rule"]["end"]) =>
    withRule({ freq: "weekly", interval: 1, weekdays: ["tuesday"], end });

  it("accepts an ordinary series", () => {
    expect(weekly({ kind: "onDate", date: "2031-09-01" })).toSatisfy(
      (s: SeriesDefinition) => validateSeries(s).ok,
    );
    expect(validateSeries(weekly({ kind: "never" })).ok).toBe(true);
  });

  it("refuses an end date beyond the maximum series span", () => {
    const result = validateSeries(weekly({ kind: "onDate", date: "2037-09-01" }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("seriesSpanYears");
    expect(result.ok === false && result.message).toContain("10 years");
  });

  it("refuses a count that would run beyond the maximum series span", () => {
    expect(validateSeries(weekly({ kind: "afterCount", count: 400 })).ok).toBe(true);
    expect(validateSeries(weekly({ kind: "afterCount", count: 600 })).ok).toBe(false);
  });

  it("refuses more cancelled occurrences than a series may carry", () => {
    const excludedStarts = Array.from({ length: 201 }, (_, i) => i);
    const result = validateSeries({ ...weekly({ kind: "never" }), excludedStarts });
    expect(result.ok === false && result.reason).toBe("excludedStarts");
  });

  it("refuses a rule that could never place an occurrence", () => {
    expect(
      validateSeries(
        withRule({ freq: "daily", interval: 0, end: { kind: "never" } }),
      ).ok,
    ).toBe(false);
    expect(
      validateSeries(
        withRule({ freq: "weekly", interval: 1, weekdays: [], end: { kind: "never" } }),
      ).ok,
    ).toBe(false);
  });
});

describe("ICS serialization", () => {
  const rome = (rule: SeriesDefinition["rule"]): SeriesDefinition => ({
    anchor: ROME_TUESDAY_MORNING,
    rule,
  });

  it("writes a weekly rule", () => {
    expect(
      toRRule(
        rome({
          freq: "weekly",
          interval: 1,
          weekdays: ["tuesday"],
          end: { kind: "never" },
        }),
      ),
    ).toBe("FREQ=WEEKLY;BYDAY=TU");
  });

  it("writes an interval and several weekdays, and ends on the last occurrence", () => {
    // UNTIL is the last occurrence's own instant in UTC, which is unambiguous
    // in a way "the end of that local day" is not.
    expect(
      toRRule(
        rome({
          freq: "weekly",
          interval: 2,
          weekdays: ["monday", "wednesday"],
          end: { kind: "onDate", date: "2026-12-31" },
        }),
      ),
    ).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261223T080000Z");
  });

  it("writes a count", () => {
    expect(
      toRRule(
        rome({
          freq: "weekly",
          interval: 1,
          weekdays: ["tuesday"],
          end: { kind: "afterCount", count: 3 },
        }),
      ),
    ).toBe("FREQ=WEEKLY;BYDAY=TU;COUNT=3");
  });

  it("writes daily, monthly and yearly rules", () => {
    expect(toRRule(rome({ freq: "daily", interval: 3, end: { kind: "never" } }))).toBe(
      "FREQ=DAILY;INTERVAL=3",
    );
    expect(
      toRRule(
        rome({
          freq: "monthly",
          interval: 1,
          monthlyMode: "dayOfMonth",
          end: { kind: "never" },
        }),
      ),
    ).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
    expect(
      toRRule(
        rome({
          freq: "monthly",
          interval: 1,
          monthlyMode: "nthWeekday",
          end: { kind: "never" },
        }),
      ),
    ).toBe("FREQ=MONTHLY;BYDAY=1TU");
    expect(toRRule(rome({ freq: "yearly", interval: 1, end: { kind: "never" } }))).toBe(
      "FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=1",
    );
  });

  it("writes cancelled occurrences as EXDATE, and nothing when there are none", () => {
    const weekly = rome({
      freq: "weekly",
      interval: 1,
      weekdays: ["tuesday"],
      end: { kind: "never" },
    });
    expect(toExDate(weekly)).toBeNull();
    expect(
      toExDate({
        ...weekly,
        excludedStarts: [
          Date.parse("2026-09-08T07:00:00Z"),
          Date.parse("2026-09-22T07:00:00Z"),
        ],
      }),
    ).toBe("20260908T070000Z,20260922T070000Z");
  });
});

describe("where a series starts", () => {
  it("is the first occurrence the rule places, not the anchor date", () => {
    // The anchor is a Tuesday; the rule repeats on Thursdays. What an
    // invitation has to announce as the start of the pattern is the Thursday.
    const thursdays: SeriesDefinition = {
      anchor: ROME_TUESDAY_MORNING,
      rule: {
        freq: "weekly",
        interval: 1,
        weekdays: ["thursday"],
        end: { kind: "never" },
      },
    };
    expect(
      new Date(firstOccurrence(thursdays)!.startsAt).toISOString(),
    ).toBe("2026-09-03T07:00:00.000Z");
  });

  it("stays the rule's own first occurrence even once it has been cancelled", () => {
    // EXDATE removes it from the recurrence set; the set is still anchored
    // there, so moving the start would shift every later occurrence.
    const weekly: SeriesDefinition = {
      anchor: ROME_TUESDAY_MORNING,
      rule: {
        freq: "weekly",
        interval: 1,
        weekdays: ["tuesday"],
        end: { kind: "never" },
      },
      excludedStarts: [Date.parse("2026-09-01T07:00:00Z")],
    };
    expect(new Date(firstOccurrence(weekly)!.startsAt).toISOString()).toBe(
      "2026-09-01T07:00:00.000Z",
    );
  });

  it("is nothing at all for a rule that places no occurrence", () => {
    expect(
      firstOccurrence({
        anchor: ROME_TUESDAY_MORNING,
        rule: {
          freq: "weekly",
          interval: 1,
          weekdays: [],
          end: { kind: "never" },
        },
      }),
    ).toBeNull();
  });
});

describe("splitSeries", () => {
  const weeklyTuesdays = (end: SeriesDefinition["rule"]["end"]): SeriesDefinition => ({
    anchor: ROME_TUESDAY_MORNING,
    rule: { freq: "weekly", interval: 1, weekdays: ["tuesday"], end },
  });

  const SEPTEMBER = ["2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"] as const;

  it("puts the occurrences before the split in one series and the rest in the other", () => {
    const { truncated, continuation } = splitSeries(
      weeklyTuesdays({ kind: "never" }),
      Date.parse("2026-09-15T07:00:00Z"),
    );

    expect(truncated && startsOf(truncated, ...SEPTEMBER)).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-08T07:00:00.000Z",
    ]);
    expect(startsOf(continuation, ...SEPTEMBER)).toEqual([
      "2026-09-15T07:00:00.000Z",
      "2026-09-22T07:00:00.000Z",
      "2026-09-29T07:00:00.000Z",
    ]);
  });

  it("has nothing to truncate when the split is at the very first occurrence", () => {
    // Nothing precedes it, so this is an edit of the whole series and the
    // caller has no second resource to create.
    const { truncated, continuation } = splitSeries(
      weeklyTuesdays({ kind: "never" }),
      Date.parse("2026-09-01T07:00:00Z"),
    );

    expect(truncated).toBeNull();
    expect(startsOf(continuation, ...SEPTEMBER)).toHaveLength(5);
  });

  it("carries the remaining count over to the continuation", () => {
    const { truncated, continuation } = splitSeries(
      weeklyTuesdays({ kind: "afterCount", count: 5 }),
      Date.parse("2026-09-15T07:00:00Z"),
    );

    expect(truncated && startsOf(truncated, ...SEPTEMBER)).toHaveLength(2);
    expect(continuation.rule.end).toEqual({ kind: "afterCount", count: 3 });
    expect(startsOf(continuation, ...SEPTEMBER)).toHaveLength(3);
  });

  it("leaves the continuation with a single occurrence when the split is at the last", () => {
    const { truncated, continuation } = splitSeries(
      weeklyTuesdays({ kind: "afterCount", count: 5 }),
      Date.parse("2026-09-29T07:00:00Z"),
    );

    expect(truncated && startsOf(truncated, ...SEPTEMBER)).toHaveLength(4);
    expect(startsOf(continuation, ...SEPTEMBER)).toEqual([
      "2026-09-29T07:00:00.000Z",
    ]);
  });

  it("gives each side the cancelled occurrences that fall on its side", () => {
    const { truncated, continuation } = splitSeries(
      {
        ...weeklyTuesdays({ kind: "never" }),
        excludedStarts: [
          Date.parse("2026-09-08T07:00:00Z"),
          Date.parse("2026-09-22T07:00:00Z"),
        ],
      },
      Date.parse("2026-09-15T07:00:00Z"),
    );

    expect(truncated?.excludedStarts).toEqual([Date.parse("2026-09-08T07:00:00Z")]);
    expect(continuation.excludedStarts).toEqual([Date.parse("2026-09-22T07:00:00Z")]);
  });
});

describe("affectsOnlyThePast", () => {
  const NOW = Date.parse("2026-09-15T12:00:00Z");

  it("is true when every instant an edit touches has already happened", () => {
    expect(affectsOnlyThePast([NOW - 10_000, NOW - 5_000], NOW)).toBe(true);
  });

  it("is false when any instant is still ahead", () => {
    // Moving a past occurrence into the future changes someone's plans, and
    // so does moving a future one anywhere at all.
    expect(affectsOnlyThePast([NOW - 10_000, NOW + 5_000], NOW)).toBe(false);
    expect(affectsOnlyThePast([NOW + 1_000, NOW + 5_000], NOW)).toBe(false);
  });

  it("treats now itself as not yet past", () => {
    expect(affectsOnlyThePast([NOW, NOW - 1], NOW)).toBe(false);
  });

  it("is true when an edit touches no occurrence at all", () => {
    expect(affectsOnlyThePast([], NOW)).toBe(true);
  });

  it("answers for a whole series, not just a pair of instants", () => {
    // The generalisation that a series forces: "all affected occurrences are
    // in the past" is the same rule the single-event predicate stated.
    const finished = expandSeries(
      {
        anchor: ROME_TUESDAY_MORNING,
        rule: {
          freq: "weekly",
          interval: 1,
          weekdays: ["tuesday"],
          end: { kind: "afterCount", count: 2 },
        },
      },
      {
        windowStartMs: Date.parse("2026-09-01T00:00:00Z"),
        windowEndMs: Date.parse("2026-10-01T00:00:00Z"),
      },
    ).map((o) => o.startsAt);

    expect(affectsOnlyThePast(finished, NOW)).toBe(true);
    expect(affectsOnlyThePast(finished, Date.parse("2026-09-05T00:00:00Z"))).toBe(false);
  });
});

describe("where a bare link to a series lands", () => {
  const FOUR_TUESDAYS: SeriesDefinition = {
    anchor: ROME_TUESDAY_MORNING,
    rule: {
      freq: "weekly",
      interval: 1,
      weekdays: ["tuesday"],
      end: { kind: "afterCount", count: 4 },
    },
  };

  it("is the first occurrence at or after the instant asked about", () => {
    const next = nextOccurrenceFrom(FOUR_TUESDAYS, Date.parse("2026-09-10T00:00:00Z"));
    expect(new Date(next!.startsAt).toISOString()).toBe("2026-09-15T07:00:00.000Z");
  });

  it("falls back to the last occurrence once the series has ended", () => {
    // An old message about a finished standup must not become a dead page.
    const past = nextOccurrenceFrom(FOUR_TUESDAYS, Date.parse("2027-01-01T00:00:00Z"));
    expect(new Date(past!.startsAt).toISOString()).toBe("2026-09-22T07:00:00.000Z");
  });

  it("skips a cancelled occurrence rather than opening it", () => {
    const withSkip: SeriesDefinition = {
      ...FOUR_TUESDAYS,
      excludedStarts: [Date.parse("2026-09-15T07:00:00Z")],
    };
    const next = nextOccurrenceFrom(withSkip, Date.parse("2026-09-10T00:00:00Z"));
    expect(new Date(next!.startsAt).toISOString()).toBe("2026-09-22T07:00:00.000Z");
  });

  it("has nowhere to land when every occurrence has been cancelled", () => {
    const allSkipped: SeriesDefinition = {
      ...FOUR_TUESDAYS,
      excludedStarts: [
        Date.parse("2026-09-01T07:00:00Z"),
        Date.parse("2026-09-08T07:00:00Z"),
        Date.parse("2026-09-15T07:00:00Z"),
        Date.parse("2026-09-22T07:00:00Z"),
      ],
    };
    expect(nextOccurrenceFrom(allSkipped, Date.parse("2026-09-01T00:00:00Z"))).toBeNull();
  });

  it("keeps looking forward for an open-ended series", () => {
    const forever: SeriesDefinition = {
      anchor: ROME_TUESDAY_MORNING,
      rule: {
        freq: "weekly",
        interval: 1,
        weekdays: ["tuesday"],
        end: { kind: "never" },
      },
    };
    // Still 09:00 in Rome — March is winter time there, so 08:00 UTC.
    const next = nextOccurrenceFrom(forever, Date.parse("2030-03-04T00:00:00Z"));
    expect(new Date(next!.startsAt).toISOString()).toBe("2030-03-05T08:00:00.000Z");
  });
});

describe("how many occurrences remain", () => {
  const FOUR_TUESDAYS: SeriesDefinition = {
    anchor: ROME_TUESDAY_MORNING,
    rule: {
      freq: "weekly",
      interval: 1,
      weekdays: ["tuesday"],
      end: { kind: "afterCount", count: 4 },
    },
  };

  it("counts the occurrences still to come, and not the one asked from", () => {
    // Standing on the second Tuesday: two more after it.
    expect(
      remainingOccurrences(FOUR_TUESDAYS, Date.parse("2026-09-08T07:00:01Z")),
    ).toBe(2);
  });

  it("is zero for a series that has run out", () => {
    expect(
      remainingOccurrences(FOUR_TUESDAYS, Date.parse("2027-01-01T00:00:00Z")),
    ).toBe(0);
  });

  it("does not count a cancelled occurrence", () => {
    const withSkip: SeriesDefinition = {
      ...FOUR_TUESDAYS,
      excludedStarts: [Date.parse("2026-09-15T07:00:00Z")],
    };
    expect(
      remainingOccurrences(withSkip, Date.parse("2026-09-08T07:00:01Z")),
    ).toBe(1);
  });

  it("has no number to give for an open-ended series", () => {
    // Nothing renews an open-ended series and nothing ever asks the organizer
    // to, so there is no count — and the horizon's worth would be a number
    // they never chose.
    const forever: SeriesDefinition = {
      anchor: ROME_TUESDAY_MORNING,
      rule: {
        freq: "weekly",
        interval: 1,
        weekdays: ["tuesday"],
        end: { kind: "never" },
      },
    };
    expect(remainingOccurrences(forever, Date.parse("2026-09-08T07:00:01Z"))).toBeNull();
  });
});

describe("what an edit reaches", () => {
  /** Tuesdays 1, 8, 15 and 22 September 2026, 09:00 Rome. */
  const FOUR_TUESDAYS: SeriesDefinition = {
    anchor: ROME_TUESDAY_MORNING,
    rule: {
      freq: "weekly",
      interval: 1,
      weekdays: ["tuesday"],
      end: { kind: "afterCount", count: 4 },
    },
  };
  /** Before the series starts, so every occurrence is still ahead. */
  const AUGUST = Date.parse("2026-08-01T00:00:00Z");

  it("counts every occurrence when the edit is to the whole series", () => {
    expect(reachOfEdit(FOUR_TUESDAYS, AUGUST).occurrenceCount).toBe(4);
  });

  it("counts from the split point onward for 'this and following'", () => {
    // Standing on the third Tuesday: it and the one after it.
    const reach = reachOfEdit(
      FOUR_TUESDAYS,
      AUGUST,
      Date.parse("2026-09-15T07:00:00Z"),
    );
    expect(reach.occurrenceCount).toBe(2);
  });

  it("does not count an occurrence nobody is expected at", () => {
    const withSkip: SeriesDefinition = {
      ...FOUR_TUESDAYS,
      excludedStarts: [Date.parse("2026-09-08T07:00:00Z")],
    };
    expect(reachOfEdit(withSkip, AUGUST).occurrenceCount).toBe(3);
  });

  it("says a finished series' edit touches nobody's future", () => {
    const { instants } = reachOfEdit(
      FOUR_TUESDAYS,
      Date.parse("2027-01-01T00:00:00Z"),
    );
    expect(
      affectsOnlyThePast(instants, Date.parse("2027-01-01T00:00:00Z")),
    ).toBe(true);
  });

  it("says an edit reaching one future occurrence is not past-only", () => {
    // Standing between the third and fourth Tuesday: the last one is ahead.
    const midSeries = Date.parse("2026-09-16T00:00:00Z");
    const { instants } = reachOfEdit(FOUR_TUESDAYS, midSeries);
    expect(affectsOnlyThePast(instants, midSeries)).toBe(false);
  });

  it("has no count for an open-ended rule, and always something ahead", () => {
    const forever: SeriesDefinition = {
      anchor: ROME_TUESDAY_MORNING,
      rule: {
        freq: "weekly",
        interval: 1,
        weekdays: ["tuesday"],
        end: { kind: "never" },
      },
    };
    // Years after the anchor, and still: nothing renews it, so there is no
    // number to name and there is always another Tuesday to tell people about.
    const later = Date.parse("2030-03-04T00:00:00Z");
    const reach = reachOfEdit(forever, later);
    expect(reach.occurrenceCount).toBeNull();
    expect(affectsOnlyThePast(reach.instants, later)).toBe(false);
  });

  it("reaches nothing when the split point is past the last occurrence", () => {
    const reach = reachOfEdit(
      FOUR_TUESDAYS,
      AUGUST,
      Date.parse("2027-01-01T00:00:00Z"),
    );
    expect(reach.occurrenceCount).toBe(0);
    // Nothing affected is nothing to tell anyone about.
    expect(affectsOnlyThePast(reach.instants, AUGUST)).toBe(true);
  });
});
