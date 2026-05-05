import { getRefInsertContext } from "@/lib/spreadsheet-formula-refs";
import type { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";
import { type RefObject, useEffect, useRef } from "react";

interface UseCellPickerOptions {
  binding: SpreadsheetYjsBinding | null;
  /** Grid selection — changes in this value are interpreted as cell picks
   *  while `enabled` is true. */
  selection: { row: number; col: number } | null;
  /** The cell currently being edited; never replaced by a pick. */
  editingTarget: { row: number; col: number } | null;
  /** Current draft text and cursor (so the hook can compute the replacement
   *  span). */
  draft: string;
  cursor: number;
  /** When false, the hook is inert (no picks, no state mutations). */
  enabled: boolean;
  /** Input element receiving the inserted text — focused after each pick so
   *  the user can keep typing. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Called with the new draft and cursor position after a successful pick. */
  onPick: (next: { draft: string; cursor: number }) => void;
}

/**
 * Click-to-pick state machine for a formula editor coupled with a separate
 * grid selection. Watches `selection`; when it changes while `enabled` is
 * true, inserts (or replaces) the corresponding cell name at the cursor in
 * `draft` and emits via `onPick`.
 *
 * Tracks an internal "picking span" so a drag-select replaces the previously
 * inserted ref instead of appending — call `resetSpan()` whenever the user
 * types so subsequent picks start fresh.
 */
export function useCellPicker({
  binding,
  selection,
  editingTarget,
  draft,
  cursor,
  enabled,
  inputRef,
  onPick,
}: UseCellPickerOptions) {
  const spanRef = useRef<{ start: number; end: number } | null>(null);
  const lastSelectionRef = useRef<{ row: number; col: number } | null>(null);

  useEffect(() => {
    if (!enabled || !binding || !selection) {
      lastSelectionRef.current = selection;
      return;
    }
    const prev = lastSelectionRef.current;
    lastSelectionRef.current = selection;

    // Skip the initial selection captured at enable time — no real click yet.
    if (prev === null) return;
    if (prev.row === selection.row && prev.col === selection.col) return;

    // Don't pick the cell being edited as its own reference.
    if (
      editingTarget &&
      selection.row === editingTarget.row &&
      selection.col === editingTarget.col
    ) {
      return;
    }

    const refName = binding.cellNameAt(selection.row, selection.col);
    const span =
      spanRef.current
      ?? getRefInsertContext(draft, cursor)
      ?? { start: cursor, end: cursor };

    const next = draft.substring(0, span.start) + refName + draft.substring(span.end);
    const newCursor = span.start + refName.length;
    spanRef.current = { start: span.start, end: newCursor };

    onPick({ draft: next, cursor: newCursor });

    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newCursor, newCursor);
    });
  }, [selection, enabled, binding, editingTarget, draft, cursor, inputRef, onPick]);

  /** Call when the user types or focuses, to abandon the in-progress span so
   *  subsequent picks insert at the cursor instead of replacing the last ref. */
  const resetSpan = () => {
    spanRef.current = null;
  };

  /** Call on focus to clear last-known selection so the first real
   *  selection-change is treated as the first pick. */
  const resetSelectionMemory = () => {
    lastSelectionRef.current = null;
  };

  return { resetSpan, resetSelectionMemory };
}
