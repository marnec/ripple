/**
 * Whether to ask the organizer "notify invitees?", and what the prompt says it
 * will send.
 *
 * The one-off event's prompt already asks the question; a repeating meeting
 * adds the only thing that makes the answer hard — the same sentence must not
 * be shown whether one Tuesday or forty-seven meetings are moving. So the copy
 * names both numbers: how many people, and how many occurrences.
 *
 * The decision itself is not made here. `reachOfEdit` says what an edit
 * touches and `affectsOnlyThePast` says whether any of it is still ahead, both
 * in the shared recurrence module, because the server runs the very same two
 * functions as its safety net for every door into these mutations that is not
 * this prompt (spec 0003, "Email and ICS"). This module is the copy and the
 * arithmetic between them.
 */
import {
  affectsOnlyThePast,
  reachOfEdit,
  type SeriesDefinition,
} from "@ripple/shared/recurrence";

import type { EditScope } from "./edit-scope";

/**
 * The edit whose blast radius is being weighed.
 *
 * A single occurrence carries its own instants rather than a series, because
 * that reach is not something the rule can answer: an occurrence may have been
 * moved off the rule already, and the edit may be moving it again. Old start
 * and new start, exactly as a one-off event's reschedule reports them — a
 * single instant when nothing is moving at all.
 */
export type ScopedEdit =
  | { scope: "occurrence"; instants: number[] }
  | { scope: "following"; series: SeriesDefinition; originalStartMs: number }
  | { scope: "series"; series: SeriesDefinition };

export interface NotifyDecision {
  /**
   * Whether to put the prompt in front of the organizer. False means write
   * straight through: either nobody would be told, or nobody's plans change.
   */
  ask: boolean;
  /** "2 invitees, this occurrence" — what the prompt says it will send. */
  summary: string;
}

/** How many occurrences this edit reaches, said in the organizer's terms. */
function occurrencePhrase(scope: EditScope, count: number | null): string {
  if (scope === "occurrence") return "this occurrence";
  if (scope === "following") {
    // No count means an open-ended rule: nobody chose a number, so naming one
    // would be inventing it.
    if (count === null) return "this and every following occurrence";
    if (count <= 1) return "this occurrence";
    return `this and ${count - 1} following ${
      count - 1 === 1 ? "occurrence" : "occurrences"
    }`;
  }
  if (count === null) return "every occurrence";
  if (count <= 1) return "its one occurrence";
  return `all ${count} occurrences`;
}

export function decideNotify(
  edit: ScopedEdit,
  { inviteeCount, nowMs }: { inviteeCount: number; nowMs: number },
): NotifyDecision {
  const reach =
    edit.scope === "occurrence"
      ? { occurrenceCount: 1, instants: edit.instants }
      : reachOfEdit(
          edit.series,
          nowMs,
          edit.scope === "following" ? edit.originalStartMs : undefined,
        );

  return {
    // Nobody to tell, or nobody's plans changing: both mean write silently
    // rather than add a question the organizer can only answer one way.
    ask: inviteeCount > 0 && !affectsOnlyThePast(reach.instants, nowMs),
    summary: `${inviteeCount} ${inviteeCount === 1 ? "invitee" : "invitees"}, ${occurrencePhrase(
      edit.scope,
      reach.occurrenceCount,
    )}`,
  };
}
