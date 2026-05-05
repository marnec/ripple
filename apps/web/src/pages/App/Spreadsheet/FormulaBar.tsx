import { Input } from "@/components/ui/input";
import { useCellPicker } from "@/hooks/use-cell-picker";
import { extractCellRefs } from "@/lib/spreadsheet-formula-refs";
import {
  filterFormulas,
  getFormulaPickerContext,
} from "@/lib/spreadsheet-formulas";
import type { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  FormulaPickerDropdown,
  type FormulaPickerHandle,
} from "./FormulaPickerDropdown";

type CellCoord = { row: number; col: number };

interface FormulaBarProps {
  binding: SpreadsheetYjsBinding | null;
  selection: CellCoord | null;
  isEditing: boolean;
  /** Notify the page when the bar is in formula-pickup mode so the grid can
   *  suppress the focus-shift on cell mousedown. */
  onPickingChange?: (picking: boolean) => void;
  /** Notify the page when the bar gains/loses focus so the page-level
   *  selection-based highlight effect can step aside. */
  onFocusChange?: (focused: boolean) => void;
}

export function FormulaBar({
  binding,
  selection,
  isEditing,
  onPickingChange,
  onFocusChange,
}: FormulaBarProps) {
  // Live raw value from Yjs (re-renders on local + remote yData changes).
  const value = useSyncExternalStore(
    (listener) => binding?.subscribe(listener) ?? (() => {}),
    () =>
      binding && selection ? binding.getRawCellValue(selection.row, selection.col) : "",
  );

  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  // The cell being edited is locked at focus time. Subsequent selection
  // changes (clicking another cell while the bar is focused) must NOT
  // redirect the commit to a different cell. Mirrored in state for rendering
  // (label) and tracked in a ref for use inside the blur closure.
  const [editingTarget, setEditingTarget] = useState<CellCoord | null>(null);
  const editingTargetRef = useRef<CellCoord | null>(null);
  const skipNextCommitRef = useRef(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const pickerHandleRef = useRef<FormulaPickerHandle>(null);
  const [pickerPos, setPickerPos] = useState({ x: 0, y: 0 });
  const [pickerDismissed, setPickerDismissed] = useState(false);

  // Picker visibility is driven by cursor context so it also fires inside
  // nested calls (`=SUM(A1, AV`) and after operators (`=A1+SU`) — not just
  // at the top level. When no context is detected (e.g. `=1+2`, after `)`),
  // the picker steps aside so Enter commits.
  const pickerCtx = isFocused && !pickerDismissed
    ? getFormulaPickerContext(draft, cursor)
    : null;
  const pickerShouldShow =
    pickerCtx !== null && filterFormulas(pickerCtx.query).length > 0;
  const pickerQuery = pickerCtx?.query ?? "";

  const inputValue = isFocused ? draft : value;
  // While focused, show the locked editing target's label so a mouse-pick
  // doesn't visually shift the bar onto the picked cell.
  const labelTarget = isFocused ? editingTarget ?? selection : selection;
  const cellLabel = binding && labelTarget ? binding.cellNameAt(labelTarget.row, labelTarget.col) : "";
  const disabled = !binding || !selection || isEditing;
  const isPicking = isFocused && draft.startsWith("=");

  const handleCellPick = (next: { draft: string; cursor: number }) => {
    setDraft(next.draft);
    setCursor(next.cursor);
  };

  const { resetSpan, resetSelectionMemory } = useCellPicker({
    binding,
    selection,
    editingTarget,
    draft,
    cursor,
    enabled: isPicking,
    inputRef,
    onPick: handleCellPick,
  });

  // Notify the page so it can intercept grid mousedown to keep the input focused.
  useEffect(() => {
    onPickingChange?.(isPicking);
  }, [isPicking, onPickingChange]);

  // Notify the page so it can suppress the selection-based highlight effect
  // while the bar owns the highlight state.
  useEffect(() => {
    onFocusChange?.(isFocused);
  }, [isFocused, onFocusChange]);

  // Render colored borders around referenced cells while the bar is being edited.
  useEffect(() => {
    if (!binding) return;
    if (!isFocused || !draft.startsWith("=")) {
      binding.clearFormulaEditHighlights();
      return;
    }
    binding.setFormulaEditHighlights(extractCellRefs(draft).map((m) => m.ref));
    return () => {
      binding.clearFormulaEditHighlights();
    };
  }, [binding, draft, isFocused]);

  const recomputePickerPos = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPickerPos({ x: r.left, y: r.bottom + 2 });
  };

  const commit = () => {
    const target = editingTargetRef.current;
    if (!binding || !target) return;
    // Compare against the locked target's *own* current value, not `value`,
    // which now reflects whatever cell is currently selected — they differ if
    // the user changed selection while focused on the bar.
    const current = binding.getRawCellValue(target.row, target.col);
    if (draft === current) return;
    binding.setRawCellValue(target.row, target.col, draft);
  };

  const insertFormula = (name: string) => {
    const el = inputRef.current;
    if (!el) return;
    const ctx = getFormulaPickerContext(draft, cursor);
    if (!ctx) return;
    const newBefore = draft.substring(0, ctx.partialStart) + name + "(";
    const next = newBefore + draft.substring(cursor);
    const newCursor = newBefore.length;
    setDraft(next);
    setCursor(newCursor);
    setPickerDismissed(true);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
    setCursor(e.target.selectionStart ?? e.target.value.length);
    setPickerDismissed(false);
    // User typed — abandon the in-progress click-pick span so the next click
    // starts a fresh insertion at the new cursor position.
    resetSpan();
    recomputePickerPos();
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    setCursor(el.selectionStart ?? el.value.length);
  };

  const handleFocus = () => {
    // Lock the commit target now. If selection is null (no cell), the
    // ref stays null and commit() will be a no-op — no accidental write.
    editingTargetRef.current = selection;
    setEditingTarget(selection);
    const initial = selection ? value : "";
    setDraft(initial);
    setCursor(initial.length);
    setIsFocused(true);
    setPickerDismissed(false);
    resetSpan();
    resetSelectionMemory();
    recomputePickerPos();
  };

  const handleBlur = () => {
    if (skipNextCommitRef.current) {
      skipNextCommitRef.current = false;
    } else {
      commit();
    }
    setIsFocused(false);
    editingTargetRef.current = null;
    setEditingTarget(null);
    resetSpan();
    resetSelectionMemory();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Suppress jspreadsheet's keyboard handlers while the bar is focused.
    // After a mouse-pick the picked cell becomes jspreadsheet's selection,
    // so Backspace/Delete would otherwise clear that cell's content while
    // the user thinks they're editing the formula text.
    e.stopPropagation();

    if (pickerShouldShow) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        pickerHandleRef.current?.handleKey(e.key);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = pickerHandleRef.current?.handleKey("Enter");
        if (selected) insertFormula(selected);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPickerDismissed(true);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      skipNextCommitRef.current = true;
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      skipNextCommitRef.current = true;
      e.currentTarget.blur();
    }
  };

  return (
    <div className="hidden md:flex flex-1 min-w-0 items-center gap-2 px-4">
      <span
        className="font-mono text-xs text-muted-foreground tabular-nums w-12 text-right select-none"
        aria-label="Active cell"
      >
        {cellLabel}
      </span>
      <Input
        ref={inputRef}
        type="text"
        data-formula-bar=""
        value={inputValue}
        disabled={disabled}
        placeholder={selection ? "" : "Select a cell"}
        onChange={handleChange}
        onSelect={handleSelect}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="font-mono text-sm"
        aria-label="Cell raw content"
      />
      <FormulaPickerDropdown
        ref={pickerHandleRef}
        position={pickerPos}
        query={pickerQuery}
        onSelect={insertFormula}
        onDismiss={() => setPickerDismissed(true)}
        visible={pickerShouldShow}
      />
    </div>
  );
}
