import { v } from "convex/values";
import { normalizeTagList } from "../../tagSync";
import type { Doc } from "../../_generated/dataModel";

/**
 * Priority ↔ label sync (plan C). A link may map each Ripple priority to one
 * provider label (`projectIntegrationLinks.priorityLabels`). Those labels are
 * a vocabulary separate from tags: this module is the only place that adds
 * them to an outbound label set and strips them from an inbound one, so the
 * tag system (`tasks.labels`, `tags`, `taskTags`) never sees them.
 *
 * Pure — no Convex ctx — so both directions are unit-testable.
 */

export type Priority = Doc<"tasks">["priority"];

/** The four-slot map as stored on the link (normalized values). */
export type PriorityLabelMap = NonNullable<
  Doc<"projectIntegrationLinks">["priorityLabels"]
>;

export const priorityLabelMapValidator = v.object({
  urgent: v.string(),
  high: v.string(),
  medium: v.string(),
  low: v.string(),
});

/** Highest first — the order "several mapped labels at once" resolves in. */
export const PRIORITIES_HIGHEST_FIRST: readonly Priority[] = [
  "urgent",
  "high",
  "medium",
  "low",
];

/**
 * The outbound label set for a task: its tags plus the label its priority
 * maps to. Normalized and deduped, tags first. Without a map, just the tags.
 */
export function withPriorityLabel(
  tags: readonly string[],
  priority: Priority,
  map: PriorityLabelMap | undefined,
): string[] {
  const base = normalizeTagList(tags);
  if (!map) return base;
  const label = map[priority];
  return base.includes(label) ? base : [...base, label];
}

/**
 * Split an inbound provider label set into the tags Ripple should keep and
 * the priority the mapped label(s) stood for. Every mapped label is stripped;
 * when several are present the highest wins. `priority` is undefined when no
 * mapped label is present — the absence of a label is not a statement, and
 * the caller leaves the task's priority alone.
 */
export function splitPriorityLabels(
  labels: readonly string[],
  map: PriorityLabelMap | undefined,
): { tags: string[]; priority: Priority | undefined } {
  const normalized = normalizeTagList(labels);
  if (!map) return { tags: normalized, priority: undefined };

  const labelToPriority = new Map<string, Priority>();
  for (const p of PRIORITIES_HIGHEST_FIRST) labelToPriority.set(map[p], p);

  const tags = normalized.filter((l) => !labelToPriority.has(l));
  const present = new Set(
    normalized.map((l) => labelToPriority.get(l)).filter((p) => p !== undefined),
  );
  const priority = PRIORITIES_HIGHEST_FIRST.find((p) => present.has(p));
  return { tags, priority };
}
