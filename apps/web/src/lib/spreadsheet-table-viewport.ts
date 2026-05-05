/**
 * Pure helpers for translating (row, col) coordinates into the `<td>` element
 * jspreadsheet renders. The first child of each `<tr>` is the row-header cell,
 * so column indices are offset by 1 in the DOM.
 *
 * These helpers are split out so multiple modules (overlays, cursors) can
 * share one canonical lookup without depending on the binding class.
 */

/** The jspreadsheet worksheet element, or null if the instance hasn't mounted. */
export function getWorksheetTable(worksheet: unknown): HTMLElement | null {
  const w = worksheet as { element?: HTMLElement; el?: HTMLElement } | null;
  const el = w?.element ?? w?.el;
  if (!el) return null;
  return el.querySelector(".jss_worksheet") ?? el.closest(".jss_worksheet") ?? el;
}

/** The `<td>` at (row, col), or null if out of range. */
export function getCellElement(
  table: HTMLElement,
  row: number,
  col: number,
): HTMLElement | null {
  const tbody = table.querySelector("tbody");
  if (!tbody) return null;
  const tr = tbody.children[row] as HTMLElement | undefined;
  if (!tr) return null;
  return (tr.children[col + 1] as HTMLElement) ?? null;
}

/** Convert hex `#rrggbb` to `rgba(r, g, b, alpha)`. */
export function hexToRgba(hex: string, alpha: number): string {
  const cleanHex = hex.replace("#", "");
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const STYLE_MARKER = "data-ripple-spreadsheet-styles";

const STYLES = `
.jss-remote-cursor-label {
  position: absolute;
  top: -18px;
  left: -1px;
  font-size: 11px;
  line-height: 16px;
  padding: 0 4px;
  border-radius: 3px 3px 3px 0;
  color: #fff;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
  font-family: system-ui, sans-serif;
  opacity: 1;
  transition: opacity 0.3s ease;
}
.jss-remote-cursor-label.jss-label-hidden {
  opacity: 0;
}
.jss-cell-ref-highlight {
  background-color: rgba(251, 191, 36, 0.12) !important;
  transition: background-color 0.2s ease, box-shadow 0.2s ease;
}
.jss-cell-ref-exiting {
  background-color: transparent !important;
  transition: background-color 0.2s ease, box-shadow 0.2s ease;
}
.jss-cell-ref-indicator {
  position: relative !important;
  overflow: visible !important;
}
.jss-cell-ref-indicator::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 0 6px 6px 0;
  border-color: transparent #f59e0b transparent transparent;
  pointer-events: none;
}
.jss-formula-edit-highlight {
  background-image:
    linear-gradient(90deg, var(--fe-top-c, transparent) 50%, transparent 50%),
    linear-gradient(90deg, var(--fe-bot-c, transparent) 50%, transparent 50%),
    linear-gradient(0deg, var(--fe-lef-c, transparent) 50%, transparent 50%),
    linear-gradient(0deg, var(--fe-rig-c, transparent) 50%, transparent 50%);
  background-size: 6px 1.5px, 6px 1.5px, 1.5px 6px, 1.5px 6px;
  background-position: 0 0, 0 100%, 0 0, 100% 0;
  background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
  animation: jss-fe-march 0.5s linear infinite;
}
@keyframes jss-fe-march {
  to {
    background-position: 6px 0, -6px 100%, 0 -6px, 100% 6px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .jss-formula-edit-highlight {
    animation: none;
  }
}
`;

/**
 * Idempotently inject the stylesheet for spreadsheet overlays (cursors, ref
 * highlights, edit highlights). Multiple bindings on the same page share one
 * <style> tag — the marker attribute guards against duplicates.
 */
export function ensureSpreadsheetStyles(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector(`style[${STYLE_MARKER}]`)) return;
  const el = document.createElement("style");
  el.setAttribute(STYLE_MARKER, "");
  el.textContent = STYLES;
  document.head.appendChild(el);
}
