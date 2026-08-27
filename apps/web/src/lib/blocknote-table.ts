/**
 * BlockNote stores a table row's cells in one of two shapes, and its own type
 * is the union of both: `TableCell[]` — `{ type: "tableCell", props, content }`
 * — which is what the editor produces today, or a bare `InlineContent[]` per
 * cell, which older bodies carry.
 *
 * Every reader of a stored table has to cope with both, so the union is
 * resolved here once rather than at each site. `BlockNoteRenderer` assumed the
 * bare form and threw `cell.map is not a function` on the first real table a
 * message ever contained; `use-editor-tracking` assumed the object form and
 * would have missed the older one.
 */

interface TableCellObject {
  type?: string;
  props?: { colspan?: number; rowspan?: number };
  content?: unknown;
}

/** True for the `{ type: "tableCell", … }` arm of the union. */
function isCellObject(cell: unknown): cell is TableCellObject {
  return !!cell && !Array.isArray(cell) && typeof cell === "object";
}

/** One cell's inline nodes, whichever shape the cell is stored in. */
export function tableCellContent<T = any>(cell: unknown): T[] {
  if (isCellObject(cell)) {
    return Array.isArray(cell.content) ? (cell.content as T[]) : [];
  }
  // The bare form is the cell's inline array directly. `flat` covers bodies
  // that nested it one level deeper, which cost nothing to accept.
  return Array.isArray(cell) ? (cell.flat() as T[]) : [];
}

/** A merged cell's span, or undefined when it doesn't span. `<td>` treats 1 as absent. */
export function tableCellSpans(cell: unknown): { colSpan?: number; rowSpan?: number } {
  if (!isCellObject(cell)) return {};
  const { colspan, rowspan } = cell.props ?? {};
  return {
    colSpan: colspan && colspan > 1 ? colspan : undefined,
    rowSpan: rowspan && rowspan > 1 ? rowspan : undefined,
  };
}
