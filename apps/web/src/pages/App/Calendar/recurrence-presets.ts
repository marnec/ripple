/**
 * The repeat choices the create form offers, named after the date the
 * organizer picked. Pure — no React, no Convex — so the naming, the rules and
 * the occurrence-count preview are testable without mounting a form.
 *
 * The ladder stops here on purpose: the four presets need no configuration at
 * all, intervals ("every two weeks") and ends live behind a *Custom…* dialog,
 * and full RFC 5545 expressiveness is deliberately out of scope (see ADR 0002
 * and the spec's out-of-scope list).
 */
import {
  countOccurrences,
  validateSeries,
  type RecurrenceRule,
  type SeriesAnchor,
  type SeriesDefinition,
  type Weekday,
} from "@ripple/shared/recurrence";

export type RepeatPreset = "none" | "daily" | "weekly" | "monthly" | "custom";

const WEEKDAY_BY_INDEX: Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const WEEKDAY_LABEL: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

/** A date's weekday can only be the 1st–5th of its kind in a month. */
const ORDINAL_LABEL = ["first", "second", "third", "fourth", "fifth"] as const;

/** The picked date's weekday, in the recurrence module's vocabulary. */
export function weekdayOf(date: Date): Weekday {
  return WEEKDAY_BY_INDEX[date.getDay()];
}

/** Which weekday-of-the-month the date is: 1 for the first Tuesday, and so on. */
export function nthWeekdayOf(date: Date): number {
  return Math.ceil(date.getDate() / 7);
}

/** "Tuesday", "Tuesday and Thursday", "Monday, Wednesday and Friday". */
function weekdayList(weekdays: Weekday[]): string {
  const names = [...weekdays]
    .sort((a, b) => WEEKDAY_BY_INDEX.indexOf(a) - WEEKDAY_BY_INDEX.indexOf(b))
    .map((w) => WEEKDAY_LABEL[w]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * A custom rule in one line — "Every 2 weeks on Tuesday and Thursday". The
 * pattern only: how many occurrences it comes to is the preview's job, and
 * saying it twice in two voices is how the two drift apart.
 */
export function describeRule(rule: RecurrenceRule, date: Date): string {
  const n = rule.interval;
  const every = (unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);

  switch (rule.freq) {
    case "daily":
      return every("day");
    case "weekly": {
      const days = weekdayList(rule.weekdays ?? []);
      return days ? `${every("week")} on ${days}` : every("week");
    }
    case "monthly":
      return rule.monthlyMode === "nthWeekday"
        ? `${every("month")} on the ${ORDINAL_LABEL[nthWeekdayOf(date) - 1] ?? "first"} ${WEEKDAY_LABEL[weekdayOf(date)]}`
        : `${every("month")} on day ${date.getDate()}`;
    case "yearly":
      return every("year");
  }
}

/**
 * The repeat choices, in the order the select shows them. Once *Custom…* has
 * been configured it stops saying "Custom…" and says what it is, so the
 * collapsed select never hides the pattern the organizer chose.
 */
export function repeatPresetOptions(
  date: Date,
  customRule?: RecurrenceRule | null,
): Array<{ value: RepeatPreset; label: string }> {
  const weekday = WEEKDAY_LABEL[weekdayOf(date)];
  const ordinal = ORDINAL_LABEL[nthWeekdayOf(date) - 1] ?? "first";
  return [
    { value: "none", label: "Does not repeat" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: `Weekly on ${weekday}` },
    { value: "monthly", label: `Monthly on the ${ordinal} ${weekday}` },
    {
      value: "custom",
      label: customRule ? describeRule(customRule, date) : "Custom…",
    },
  ];
}

/**
 * The rule a repeat choice means for that date, or null for "does not repeat"
 * — which is not a rule with one occurrence, it is the absence of a series.
 *
 * *Custom…* has no rule of its own: it repeats by whatever the dialog last
 * confirmed, which is why `customRule` is passed in rather than derived. A
 * `null` there is the same statement as *Does not repeat*, so a form that
 * somehow reaches "custom" with nothing configured books a one-off rather
 * than inventing a pattern nobody asked for.
 */
export function ruleForPreset(
  preset: RepeatPreset,
  date: Date,
  customRule?: RecurrenceRule | null,
): RecurrenceRule | null {
  switch (preset) {
    case "none":
      return null;
    case "custom":
      return customRule ?? null;
    case "daily":
      return { freq: "daily", interval: 1, end: { kind: "never" } };
    case "weekly":
      return {
        freq: "weekly",
        interval: 1,
        weekdays: [weekdayOf(date)],
        end: { kind: "never" },
      };
    case "monthly":
      // By weekday rather than by date: "the first Tuesday" survives a month
      // whose 1st is a Sunday, where "the 1st" would land on whatever weekday
      // that month happens to begin with.
      return {
        freq: "monthly",
        interval: 1,
        monthlyMode: "nthWeekday",
        end: { kind: "never" },
      };
  }
}

/**
 * The rule the *Custom…* dialog opens on. Opening it is a step sideways from
 * wherever the organizer already was, never a reset: the preset they had
 * chosen carries into the dialog, and reopening it shows what they last
 * confirmed. With nothing to carry over it starts weekly on the picked date's
 * own weekday — the commonest pattern anyone reaches Custom… for.
 */
export function customRuleSeed(
  preset: RepeatPreset,
  date: Date,
  customRule: RecurrenceRule | null,
): RecurrenceRule {
  return (
    ruleForPreset(preset, date, customRule) ?? {
      freq: "weekly",
      interval: 1,
      weekdays: [weekdayOf(date)],
      end: { kind: "never" },
    }
  );
}

/**
 * What the form says about the rule beneath the Repeat select: how many
 * occurrences it will produce, or why it cannot be saved at all.
 *
 * A refusal is never a truncation. The organizer is told which limit the rule
 * crossed so they can fix the rule, because a series quietly cut short is
 * indistinguishable from one that was always that length.
 */
export type RecurrencePreview =
  | { ok: true; text: string }
  | { ok: false; message: string };

export function previewRecurrence(
  rule: RecurrenceRule,
  anchor: SeriesAnchor,
): RecurrencePreview {
  const series: SeriesDefinition = { anchor, rule };

  // The same verdict the create mutation reaches, asked here so the organizer
  // learns about a bad rule while they can still change it rather than from a
  // toast after pressing Create.
  const verdict = validateSeries(series);
  if (!verdict.ok) return { ok: false, message: verdict.message };

  const count = countOccurrences(series);
  // An open-ended series is genuinely open-ended (ADR 0002): nothing renews it
  // and nothing ever asks the organizer to. So there is no number to show, and
  // showing the horizon's worth would be a number they never chose.
  if (count === null) return { ok: true, text: "Repeats with no end date" };

  return { ok: true, text: `Repeats ${count} times` };
}
