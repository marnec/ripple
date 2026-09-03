/**
 * "Fill from pattern" for the per-link priority ↔ label map. Expands one
 * pattern carrying a `{priority}` placeholder into the four label names, so
 * an admin whose repo uses `priority/urgent`, `priority/high`, … types the
 * shape once instead of four names. Pure: the editor fills its inputs from
 * the result and saving stays a separate, explicit step.
 */

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export type PriorityLabelMap = Record<Priority, string>;

export const PRIORITY_PLACEHOLDER = "{priority}";

/**
 * Null when the pattern has no placeholder: without one the four fields
 * would all get the same name, which the server refuses as non-distinct.
 */
export function expandPriorityPattern(pattern: string): PriorityLabelMap | null {
  const trimmed = pattern.trim();
  if (!trimmed.includes(PRIORITY_PLACEHOLDER)) return null;
  const expand = (p: Priority) => trimmed.split(PRIORITY_PLACEHOLDER).join(p);
  return {
    urgent: expand("urgent"),
    high: expand("high"),
    medium: expand("medium"),
    low: expand("low"),
  };
}
