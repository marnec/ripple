import type { Reference } from "@/components/embed-references";

/**
 * Edge kinds the Dependencies section already owns. A task→task `blocks` or
 * `relates_to` link is a dependency, not context — listing it twice on the
 * same page would be noise.
 */
const DEPENDENCY_EDGE_TYPES = new Set(["blocks", "relates_to"]);

/** Group order: where the conversation about a task usually lives first. */
const GROUP_ORDER = ["document", "channel", "task", "diagram", "spreadsheet"] as const;

const GROUP_LABELS: Record<string, string> = {
  document: "Documents",
  channel: "Channels",
  task: "Tasks",
  diagram: "Diagrams",
  spreadsheet: "Spreadsheets",
};

export type ReferenceGroup = {
  sourceType: string;
  label: string;
  references: Reference[];
};

/**
 * The task's incoming references, grouped by source type for the "Referenced
 * in" section. One entry per source: a document that both embeds and mentions
 * the task is one place, not two.
 */
export function groupTaskReferences(references: Reference[]): ReferenceGroup[] {
  const bySource = new Map<string, Reference>();
  for (const ref of references) {
    if (DEPENDENCY_EDGE_TYPES.has(ref.edgeType)) continue;
    if (!bySource.has(ref.sourceId)) bySource.set(ref.sourceId, ref);
  }

  const byType = new Map<string, Reference[]>();
  for (const ref of bySource.values()) {
    const list = byType.get(ref.sourceType) ?? [];
    list.push(ref);
    byType.set(ref.sourceType, list);
  }

  const rank = (type: string) => {
    const i = (GROUP_ORDER as readonly string[]).indexOf(type);
    return i === -1 ? GROUP_ORDER.length : i;
  };

  return [...byType.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([sourceType, refs]) => ({
      sourceType,
      label: GROUP_LABELS[sourceType] ?? sourceType,
      references: refs.sort((a, b) => a.sourceName.localeCompare(b.sourceName)),
    }));
}
