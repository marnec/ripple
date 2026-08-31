/**
 * What an edit to a repeating meeting applies to.
 *
 * The scope is asked **on save**, never chosen before editing: asking up front
 * makes the organizer predict what they are about to change. So this module
 * takes a finished edit and answers what may sensibly be done with it — which
 * is a different answer for a change to what an occurrence *says*, for a
 * change to *when the rule puts it*, and for the things that only ever belong
 * to the whole ritual.
 */

export type EditScope = "occurrence" | "following" | "series";

/**
 * What an edit changes.
 *
 * A **content** edit changes what the occurrences say — title, description. A
 * **rule** edit changes where the rule puts them — the recurrence, the anchor,
 * the duration. A **series** edit changes something an occurrence has no copy
 * of at all: the tags and the roster are filed under the series and nowhere
 * else (ADR 0002), so there is no narrower thing for one to mean.
 */
export type EditKind = "content" | "rule" | "series";

export interface ScopeChoice {
  scope: EditScope;
  label: string;
  /** One line saying what this scope will do, in the organizer's terms. */
  description: string;
  /**
   * Why this scope is not on offer, or `null` when it is. Offered-but-disabled
   * rather than absent: a list that silently shrinks leaves the organizer to
   * guess whether the option was withheld or never existed, and the answer —
   * "tags belong to the whole series" — is the one thing worth saying.
   */
  disabledReason: string | null;
}

const CHOICES: Record<EditScope, Omit<ScopeChoice, "scope" | "disabledReason">> = {
  occurrence: {
    label: "This occurrence",
    description: "Only this one changes. The rest of the series is untouched.",
  },
  following: {
    label: "This and following",
    description: "The series splits here: earlier occurrences keep the old pattern.",
  },
  series: {
    label: "All occurrences",
    description: "Every occurrence changes, past ones included.",
  },
};

/** Said in place of a scope's description when that scope cannot be chosen. */
const NO_OCCURRENCE = "This series has no occurrence left to apply it to.";
const RULE_IS_THE_PATTERN =
  "A repeat pattern belongs to the series — move a single occurrence by dragging it on the calendar.";
const SERIES_WIDE = "Tags and invitations belong to the whole series.";

/**
 * The three scopes with the ones this edit cannot use marked as such.
 *
 * `hasOccurrence` is false on the one surface that has no date under it: a
 * series whose every occurrence is behind it or cancelled, reached from a bare
 * link. Nothing narrower than "all" has a coordinate to hang off there.
 */
export function scopeChoices({
  kind,
  hasOccurrence = true,
}: {
  kind: EditKind;
  hasOccurrence?: boolean;
}): ScopeChoice[] {
  const reason = (scope: EditScope): string | null => {
    if (scope === "series") return null;
    if (kind === "series") return SERIES_WIDE;
    if (!hasOccurrence) return NO_OCCURRENCE;
    if (kind === "rule" && scope === "occurrence") return RULE_IS_THE_PATTERN;
    return null;
  };
  return (["occurrence", "following", "series"] as const).map((scope) => ({
    scope,
    ...CHOICES[scope],
    disabledReason: reason(scope),
  }));
}

/** The scope a freshly-opened question starts on: the narrowest one on offer. */
export function defaultScope(choices: ScopeChoice[]): EditScope {
  return (choices.find((c) => c.disabledReason === null) ?? choices[2]).scope;
}

/**
 * How many occurrences have been customised by hand: all of them, and the
 * ones from the occurrence being edited onward. The two numbers are what the
 * two wider scopes would each reach.
 */
export interface OverrideCounts {
  series: number;
  following: number;
}

/**
 * The sentence to show before an edit is committed, or null when there is
 * nothing to warn about.
 *
 * Only a rule edit destroys anything: the original starts the overrides are
 * filed under are not where the new rule puts occurrences, so the ones the
 * edit reaches go. A content edit leaves them all standing — under "all" they
 * keep their own titles, and a split re-files the later ones onto the
 * continuation — so it never asks. A series edit touches no occurrence's own
 * row at all.
 */
export function resetNotice({
  kind,
  scope,
  overrideCounts,
}: {
  kind: EditKind;
  scope: EditScope;
  overrideCounts: OverrideCounts;
}): string | null {
  if (kind !== "rule" || scope === "occurrence") return null;
  const count = scope === "series" ? overrideCounts.series : overrideCounts.following;
  if (count === 0) return null;
  const plural = count === 1 ? "occurrence" : "occurrences";
  return `${count} edited ${plural} will be reset to the series pattern.`;
}

/** What the question says it is about, which is not the same for all three. */
export function scopeQuestion(kind: EditKind): {
  title: string;
  description: string;
} {
  if (kind === "series") {
    return {
      title: "Apply this change to…",
      description:
        "Tags and invitations are held by the series, so this reaches every occurrence of it.",
    };
  }
  return {
    title: "Apply this change to…",
    description: "This meeting repeats. Choose what the edit applies to.",
  };
}
