/**
 * What one occurrence says about the series it belongs to, in one line.
 *
 * A viewer landing on a Tuesday has to be told two things before anything else
 * makes sense: that this repeats, and how much of it is left. Saying it in one
 * sentence rather than two keeps the page from turning into a form about the
 * rule — the pattern is edited from the series, which has its own surface.
 *
 * Pure — no React, no Convex — so the wording is testable without a page.
 */
import {
  remainingOccurrences,
  type SeriesDefinition,
} from "@ripple/shared/recurrence";

import { describeRule } from "./recurrence-presets";

export function describeOccurrenceInSeries(
  series: SeriesDefinition,
  originalStartMs: number,
): string {
  // The rule's own words, from the create form's vocabulary — one voice for
  // the pattern across authoring and reading. It opens mid-sentence here
  // ("Repeats every week…"), which is the sentence's own subject rather than
  // the select's label, so its leading capital comes off.
  const rule = describeRule(series.rule, new Date(originalStartMs));
  const pattern = `Repeats ${rule.charAt(0).toLowerCase()}${rule.slice(1)}`;

  // Strictly *after* this one: a viewer already has the occurrence in front of
  // them, and counting it would make the last Tuesday claim one is left.
  const remaining = remainingOccurrences(series, originalStartMs + 1);

  if (remaining === null) return `${pattern} · no end date`;
  if (remaining === 0) return `${pattern} · this is the last one`;
  if (remaining === 1) return `${pattern} · one more after this one`;
  return `${pattern} · ${remaining} more after this one`;
}
