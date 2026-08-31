import { describe, expect, it } from "vitest";
import type { SeriesDefinition } from "@ripple/shared/recurrence";

import { decideNotify } from "./notify-scope";

/** Tuesdays 1, 8, 15 and 22 September 2026, 09:00–09:30 Rome. */
const FOUR_TUESDAYS: SeriesDefinition = {
  anchor: {
    date: "2026-09-01",
    time: "09:00",
    timezone: "Europe/Rome",
    durationMs: 30 * 60 * 1000,
  },
  rule: {
    freq: "weekly",
    interval: 1,
    weekdays: ["tuesday"],
    end: { kind: "afterCount", count: 4 },
  },
};

const SEPT_15 = Date.parse("2026-09-15T07:00:00Z");
/** Before the series starts: everything is still ahead. */
const AUGUST = Date.parse("2026-08-01T00:00:00Z");

describe("what the notify prompt says it will send", () => {
  it("names the invitees and the one occurrence a single-occurrence edit moves", () => {
    const decision = decideNotify(
      { scope: "occurrence", instants: [SEPT_15, SEPT_15 + 3_600_000] },
      { inviteeCount: 2, nowMs: AUGUST },
    );
    expect(decision.summary).toBe("2 invitees, this occurrence");
  });

  it("counts from the split point for 'this and following'", () => {
    // Standing on the third Tuesday: it and the one after it.
    const decision = decideNotify(
      {
        scope: "following",
        series: FOUR_TUESDAYS,
        originalStartMs: SEPT_15,
      },
      { inviteeCount: 2, nowMs: AUGUST },
    );
    expect(decision.summary).toBe("2 invitees, this and 1 following occurrence");
  });

  it("counts the whole series for 'all occurrences'", () => {
    const decision = decideNotify(
      { scope: "series", series: FOUR_TUESDAYS },
      { inviteeCount: 1, nowMs: AUGUST },
    );
    expect(decision.summary).toBe("1 invitee, all 4 occurrences");
  });

  it("names no number an open-ended rule never gave", () => {
    const forever: SeriesDefinition = {
      ...FOUR_TUESDAYS,
      rule: { ...FOUR_TUESDAYS.rule, end: { kind: "never" } },
    };
    expect(
      decideNotify(
        { scope: "series", series: forever },
        { inviteeCount: 5, nowMs: AUGUST },
      ).summary,
    ).toBe("5 invitees, every occurrence");
  });
});

describe("whether the notify prompt appears at all", () => {
  it("asks when the edit reaches an occurrence still ahead", () => {
    expect(
      decideNotify(
        { scope: "series", series: FOUR_TUESDAYS },
        { inviteeCount: 2, nowMs: AUGUST },
      ).ask,
    ).toBe(true);
  });

  it("stays quiet when every affected occurrence has already happened", () => {
    // Housekeeping on last quarter's standups is not news for the team.
    const december = Date.parse("2026-12-01T00:00:00Z");
    expect(
      decideNotify(
        { scope: "series", series: FOUR_TUESDAYS },
        { inviteeCount: 2, nowMs: december },
      ).ask,
    ).toBe(false);
    expect(
      decideNotify(
        {
          scope: "occurrence",
          instants: [SEPT_15, SEPT_15 + 3_600_000],
        },
        { inviteeCount: 2, nowMs: december },
      ).ask,
    ).toBe(false);
    expect(
      decideNotify(
        { scope: "following", series: FOUR_TUESDAYS, originalStartMs: SEPT_15 },
        { inviteeCount: 2, nowMs: december },
      ).ask,
    ).toBe(false);
  });

  it("stays quiet when there is nobody but the organizer to tell", () => {
    expect(
      decideNotify(
        { scope: "series", series: FOUR_TUESDAYS },
        { inviteeCount: 0, nowMs: AUGUST },
      ).ask,
    ).toBe(false);
  });
});
