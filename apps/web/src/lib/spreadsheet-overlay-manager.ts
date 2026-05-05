import { isSingleCell, parseCellName, parseRange } from "@ripple/shared/cellRef";
import { getCellElement, getWorksheetTable } from "@/lib/spreadsheet-table-viewport";

/**
 * Owns the two cell-decoration overlays the spreadsheet renders into the
 * jspreadsheet `<td>`s:
 *
 * - **Reference highlights** — persistent amber border + corner indicator,
 *   driven by the page header's "References" toggle.
 * - **Formula edit highlights** — transient marching-ants borders that follow
 *   refs in a formula being edited (one color per ref).
 *
 * Both overlays write to `td.style.boxShadow` / `td.style.background-image` /
 * CSS custom properties; this class centralizes the priority rule that edit
 * highlights suppress reference highlights while active, and re-paints the
 * reference layer when edit highlights clear.
 */
export class SpreadsheetOverlayManager {
  private static readonly EDIT_HIGHLIGHT_COLORS = [
    "#eab308", // amber
    "#ec4899", // pink
    "#10b981", // green
    "#a855f7", // purple
    "#f97316", // orange
    "#06b6d4", // cyan
  ];

  private referencedCellRefs: { cellRef: string }[] = [];
  private referencedCells: HTMLElement[] = [];
  private referencedIndicatorCells: HTMLElement[] = [];
  private referencedExitTimer: ReturnType<typeof setTimeout> | null = null;

  private editCells: HTMLElement[] = [];

  constructor(private readonly worksheet: unknown) {}

  // ---------------------------------------------------------------------------
  // Reference highlights (persistent — Link2 toggle)
  // ---------------------------------------------------------------------------

  setReferencedCells(refs: { cellRef: string }[]) {
    const wasHighlighted = this.referencedCellRefs.length > 0;
    this.referencedCellRefs = refs;
    if (refs.length === 0 && wasHighlighted) {
      this.clearReferencedCells({ animated: true });
    } else {
      this.renderReferencedCells();
    }
  }

  /** Re-render reference highlights without changing the underlying ref list.
   *  Used after structural Yjs changes that may have moved cells. */
  refreshReferencedCells() {
    if (this.referencedCellRefs.length === 0) return;
    this.renderReferencedCells();
  }

  private renderReferencedCells() {
    const table = getWorksheetTable(this.worksheet);
    if (!table) return;

    this.clearReferencedCells();

    const borderColor = "#f59e0b";
    const cellShadows = new Map<HTMLElement, Set<string>>();
    const addShadow = (td: HTMLElement, shadow: string) => {
      let set = cellShadows.get(td);
      if (!set) { set = new Set(); cellShadows.set(td, set); }
      set.add(shadow);
    };

    const topShadow = `inset 0 1.5px 0 0 ${borderColor}`;
    const bottomShadow = `inset 0 -1.5px 0 0 ${borderColor}`;
    const leftShadow = `inset 1.5px 0 0 0 ${borderColor}`;
    const rightShadow = `inset -1.5px 0 0 0 ${borderColor}`;

    for (const { cellRef } of this.referencedCellRefs) {
      if (isSingleCell(cellRef)) {
        const coords = parseCellName(cellRef);
        if (!coords) continue;

        const td = getCellElement(table, coords.row, coords.col);
        if (td) {
          td.classList.add("jss-cell-ref-highlight", "jss-cell-ref-indicator");
          addShadow(td, topShadow);
          addShadow(td, bottomShadow);
          addShadow(td, leftShadow);
          addShadow(td, rightShadow);
          this.referencedCells.push(td);
          this.referencedIndicatorCells.push(td);
        }
      } else {
        const range = parseRange(cellRef);
        if (!range) continue;

        for (let r = range.startRow; r <= range.endRow; r++) {
          for (let c = range.startCol; c <= range.endCol; c++) {
            const td = getCellElement(table, r, c);
            if (td) {
              td.classList.add("jss-cell-ref-highlight");
              if (r === range.startRow) addShadow(td, topShadow);
              if (r === range.endRow) addShadow(td, bottomShadow);
              if (c === range.startCol) addShadow(td, leftShadow);
              if (c === range.endCol) addShadow(td, rightShadow);
              this.referencedCells.push(td);
            }
          }
        }

        // Indicator on top-right cell (avoids collision with cursor labels).
        const topRightTd = getCellElement(table, range.startRow, range.endCol);
        if (topRightTd) {
          topRightTd.classList.add("jss-cell-ref-indicator");
          this.referencedIndicatorCells.push(topRightTd);
        }
      }
    }

    for (const [td, shadows] of cellShadows) {
      td.style.boxShadow = [...shadows].join(", ");
    }
  }

  private clearReferencedCells(options?: { animated?: boolean }) {
    if (this.referencedExitTimer !== null) {
      clearTimeout(this.referencedExitTimer);
      this.referencedExitTimer = null;
      for (const cell of this.referencedCells) {
        cell.classList.remove("jss-cell-ref-exiting");
      }
    }

    if (options?.animated && this.referencedCells.length > 0) {
      const exiting = [...this.referencedCells];
      for (const cell of exiting) {
        cell.classList.remove("jss-cell-ref-highlight");
        cell.classList.add("jss-cell-ref-exiting");
        cell.style.boxShadow = "";
      }
      for (const cell of this.referencedIndicatorCells) {
        cell.classList.remove("jss-cell-ref-indicator");
      }
      this.referencedCells = [];
      this.referencedIndicatorCells = [];
      this.referencedExitTimer = setTimeout(() => {
        for (const cell of exiting) cell.classList.remove("jss-cell-ref-exiting");
        this.referencedExitTimer = null;
      }, 220);
      return;
    }

    for (const cell of this.referencedCells) {
      cell.classList.remove("jss-cell-ref-highlight", "jss-cell-ref-exiting");
      cell.style.boxShadow = "";
    }
    for (const cell of this.referencedIndicatorCells) {
      cell.classList.remove("jss-cell-ref-indicator");
    }
    this.referencedCells = [];
    this.referencedIndicatorCells = [];
  }

  // ---------------------------------------------------------------------------
  // Formula edit highlights (transient — marching ants)
  // ---------------------------------------------------------------------------

  setFormulaEditHighlights(refs: string[]) {
    this.clearFormulaEditHighlights({ rerenderRefs: false });
    const table = getWorksheetTable(this.worksheet);
    if (!table) return;

    if (refs.length === 0) {
      // Re-render persistent refs since edit highlights are gone.
      this.refreshReferencedCells();
      return;
    }

    // Edit highlights overwrite cell box-shadow; suppress the persistent
    // overlay while they're active.
    this.clearReferencedCells();

    const colors = SpreadsheetOverlayManager.EDIT_HIGHLIGHT_COLORS;
    type CellEdges = { color: string; top: boolean; bot: boolean; lef: boolean; rig: boolean };
    const cellEdges = new Map<HTMLElement, CellEdges>();
    const setEdge = (td: HTMLElement, color: string, side: "top" | "bot" | "lef" | "rig") => {
      let edges = cellEdges.get(td);
      if (!edges) {
        edges = { color, top: false, bot: false, lef: false, rig: false };
        cellEdges.set(td, edges);
      }
      edges.color = color;
      edges[side] = true;
    };

    refs.forEach((ref, idx) => {
      const color = colors[idx % colors.length];
      if (isSingleCell(ref)) {
        const c = parseCellName(ref);
        if (!c) return;
        const td = getCellElement(table, c.row, c.col);
        if (!td) return;
        setEdge(td, color, "top");
        setEdge(td, color, "bot");
        setEdge(td, color, "lef");
        setEdge(td, color, "rig");
      } else {
        const r = parseRange(ref);
        if (!r) return;
        for (let row = r.startRow; row <= r.endRow; row++) {
          for (let col = r.startCol; col <= r.endCol; col++) {
            const td = getCellElement(table, row, col);
            if (!td) continue;
            if (row === r.startRow) setEdge(td, color, "top");
            if (row === r.endRow) setEdge(td, color, "bot");
            if (col === r.startCol) setEdge(td, color, "lef");
            if (col === r.endCol) setEdge(td, color, "rig");
          }
        }
      }
    });

    for (const [td, edges] of cellEdges) {
      td.classList.add("jss-formula-edit-highlight");
      td.style.setProperty("--fe-top-c", edges.top ? edges.color : "transparent");
      td.style.setProperty("--fe-bot-c", edges.bot ? edges.color : "transparent");
      td.style.setProperty("--fe-lef-c", edges.lef ? edges.color : "transparent");
      td.style.setProperty("--fe-rig-c", edges.rig ? edges.color : "transparent");
      this.editCells.push(td);
    }
  }

  clearFormulaEditHighlights(options?: { rerenderRefs?: boolean }) {
    for (const td of this.editCells) {
      td.classList.remove("jss-formula-edit-highlight");
      td.style.removeProperty("--fe-top-c");
      td.style.removeProperty("--fe-bot-c");
      td.style.removeProperty("--fe-lef-c");
      td.style.removeProperty("--fe-rig-c");
    }
    this.editCells = [];
    if (options?.rerenderRefs !== false) this.refreshReferencedCells();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  destroy() {
    if (this.referencedExitTimer !== null) clearTimeout(this.referencedExitTimer);
    this.clearReferencedCells();
    this.clearFormulaEditHighlights({ rerenderRefs: false });
  }
}
