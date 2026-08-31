/**
 * What an edit to a repeating meeting applies to.
 *
 * The scope is asked **on save**, never chosen before editing: asking up front
 * makes the organizer predict what they are about to change. So this module
 * takes a finished edit and answers what may sensibly be done with it — which
 * is a different answer for a change to what an occurrence *says* than for a
 * change to *when the rule puts it*.
 */

export type EditScope = "occurrence" | "following" | "series";

/**
 * What an edit changes. A **content** edit changes what the occurrences say —
 * title, description, venue. A **rule** edit changes where the rule puts them
 * — the recurrence, the anchor, the duration.
 */
export type EditKind = "content" | "rule";

export interface ScopeChoice {
  scope: EditScope;
  label: string;
  /** One line saying what this scope will do, in the organizer's terms. */
  description: string;
}

const CHOICES: Record<EditScope, Omit<ScopeChoice, "scope">> = {
  occurrence: {
    label: "This occurrence",
    description: "Only this one changes. The rest of the series is untouched.",
  },
  following: {
    label: "This and following",
    description:
      "The series splits here: earlier occurrences keep the old pattern.",
  },
  series: {
    label: "All occurrences",
    description: "Every occurrence changes, past ones included.",
  },
};

/**
 * The scopes this edit may be applied to, in the order they are offered.
 *
 * A rule edit has no single-occurrence meaning — a recurrence, an anchor or a
 * duration belongs to the pattern, and moving one occurrence is a drag on the
 * calendar rather than a change to the rule — so only the two wider scopes are
 * offered for it.
 */
export function scopeChoices(kind: EditKind): ScopeChoice[] {
  const scopes: EditScope[] =
    kind === "rule"
      ? ["following", "series"]
      : ["occurrence", "following", "series"];
  return scopes.map((scope) => ({ scope, ...CHOICES[scope] }));
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
 * continuation — so it never asks.
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
