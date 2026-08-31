import { describe, expect, it } from "vitest";
import {
  RECURRENCE_LIMITS,
  type RecurrenceRule,
  type SeriesAnchor,
} from "@ripple/shared/recurrence";

import {
  customRuleSeed,
  previewRecurrence,
  repeatPresetOptions,
  ruleForPreset,
} from "./recurrence-presets";

/** Tuesday 1 September 2026 — the first Tuesday of that month. */
const FIRST_TUESDAY = new Date(2026, 8, 1);
/** Tuesday 29 September 2026 — the fifth. */
const FIFTH_TUESDAY = new Date(2026, 8, 29);

describe("repeat presets", () => {
  it("names each preset after the date the organizer picked", () => {
    expect(repeatPresetOptions(FIRST_TUESDAY).map((o) => o.label)).toEqual([
      "Does not repeat",
      "Daily",
      "Weekly on Tuesday",
      "Monthly on the first Tuesday",
      "Custom…",
    ]);
  });

  it("counts which weekday of the month the date is", () => {
    expect(repeatPresetOptions(FIFTH_TUESDAY).map((o) => o.label)).toContain(
      "Monthly on the fifth Tuesday",
    );
  });

  it("offers no rule at all for the default", () => {
    expect(ruleForPreset("none", FIRST_TUESDAY)).toBeNull();
  });

  it("builds a weekly rule on the picked date's own weekday", () => {
    expect(ruleForPreset("weekly", FIRST_TUESDAY)).toEqual({
      freq: "weekly",
      interval: 1,
      weekdays: ["tuesday"],
      end: { kind: "never" },
    });
  });

  it("builds a daily rule", () => {
    expect(ruleForPreset("daily", FIRST_TUESDAY)).toEqual({
      freq: "daily",
      interval: 1,
      end: { kind: "never" },
    });
  });

  it("builds a monthly rule that repeats by weekday, not by date", () => {
    // "The first Tuesday" survives a month whose 1st is a Sunday; "the 1st"
    // would land on whatever weekday that month happens to start with.
    expect(ruleForPreset("monthly", FIRST_TUESDAY)).toEqual({
      freq: "monthly",
      interval: 1,
      monthlyMode: "nthWeekday",
      end: { kind: "never" },
    });
  });
});

describe("the custom escape hatch", () => {
  it("is offered after the four presets", () => {
    expect(repeatPresetOptions(FIRST_TUESDAY).map((o) => o.value)).toEqual([
      "none",
      "daily",
      "weekly",
      "monthly",
      "custom",
    ]);
  });

  it("repeats by the rule the dialog produced rather than by a preset", () => {
    const custom: RecurrenceRule = {
      freq: "weekly",
      interval: 2,
      weekdays: ["tuesday", "thursday"],
      end: { kind: "afterCount", count: 6 },
    };
    expect(ruleForPreset("custom", FIRST_TUESDAY, custom)).toEqual(custom);
  });

  it("opens on the preset the organizer was already on", () => {
    expect(customRuleSeed("weekly", FIRST_TUESDAY, null)).toEqual(
      ruleForPreset("weekly", FIRST_TUESDAY),
    );
  });

  it("opens on the picked date's weekday when there was no preset to carry over", () => {
    expect(customRuleSeed("none", FIRST_TUESDAY, null)).toEqual({
      freq: "weekly",
      interval: 1,
      weekdays: ["tuesday"],
      end: { kind: "never" },
    });
  });

  it("reopens on the rule the organizer last confirmed", () => {
    const custom: RecurrenceRule = {
      freq: "monthly",
      interval: 3,
      monthlyMode: "dayOfMonth",
      end: { kind: "onDate", date: "2027-03-01" },
    };
    expect(customRuleSeed("custom", FIRST_TUESDAY, custom)).toEqual(custom);
  });

  it("takes the name of the rule it was configured with, not the word Custom", () => {
    const options = repeatPresetOptions(FIRST_TUESDAY, {
      freq: "weekly",
      interval: 2,
      weekdays: ["tuesday", "thursday"],
      end: { kind: "afterCount", count: 6 },
    });
    expect(options.at(-1)).toEqual({
      value: "custom",
      label: "Every 2 weeks on Tuesday and Thursday",
    });
  });

  it("is still offered as Custom… while nothing has been configured", () => {
    expect(repeatPresetOptions(FIRST_TUESDAY, null).at(-1)?.label).toBe("Custom…");
  });
});

/** The 09:00–09:30 slot the form would anchor a series created on that Tuesday to. */
const ROME_MORNING: SeriesAnchor = {
  date: "2026-09-01",
  time: "09:00",
  timezone: "Europe/Rome",
  durationMs: 30 * 60 * 1000,
};

describe("the occurrence-count preview", () => {
  it("says how many occurrences a counted rule will produce", () => {
    expect(
      previewRecurrence(
        {
          freq: "weekly",
          interval: 1,
          weekdays: ["tuesday"],
          end: { kind: "afterCount", count: 12 },
        },
        ROME_MORNING,
      ),
    ).toEqual({ ok: true, text: "Repeats 12 times" });
  });

  it("says a rule that never ends has no end, rather than inventing a number", () => {
    expect(
      previewRecurrence(ruleForPreset("daily", FIRST_TUESDAY)!, ROME_MORNING),
    ).toEqual({ ok: true, text: "Repeats with no end date" });
  });

  it("refuses a rule running past the series-span limit, naming it", () => {
    const preview = previewRecurrence(
      {
        freq: "weekly",
        interval: 1,
        weekdays: ["tuesday"],
        // Fifteen years of Tuesdays — beyond the ten-year span a series may run.
        end: { kind: "onDate", date: "2041-09-01" },
      },
      ROME_MORNING,
    );

    expect(preview.ok).toBe(false);
    expect(preview.ok === false && preview.message).toContain(
      `${RECURRENCE_LIMITS.seriesSpanYears} years`,
    );
  });

  it("refuses a weekly rule the organizer has left with no weekday", () => {
    expect(
      previewRecurrence(
        { freq: "weekly", interval: 1, weekdays: [], end: { kind: "never" } },
        ROME_MORNING,
      ),
    ).toEqual({ ok: false, message: "A weekly repeat needs at least one weekday." });
  });

  it("refuses an interval that is not a whole number of at least one", () => {
    const preview = previewRecurrence(
      { freq: "weekly", interval: 0, weekdays: ["tuesday"], end: { kind: "never" } },
      ROME_MORNING,
    );
    expect(preview.ok).toBe(false);
  });
});
