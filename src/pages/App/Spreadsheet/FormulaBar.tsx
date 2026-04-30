import { Input } from "@/components/ui/input";
import type { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  FormulaPickerDropdown,
  type FormulaPickerHandle,
} from "./FormulaPickerDropdown";

interface FormulaBarProps {
  binding: SpreadsheetYjsBinding | null;
  selection: { row: number; col: number } | null;
  isEditing: boolean;
}

export function FormulaBar({ binding, selection, isEditing }: FormulaBarProps) {
  // Live raw value from Yjs (re-renders on local + remote yData changes).
  const value = useSyncExternalStore(
    (listener) => binding?.subscribe(listener) ?? (() => {}),
    () =>
      binding && selection ? binding.getRawCellValue(selection.row, selection.col) : "",
  );

  // While focused, the input shows the user's draft; otherwise it mirrors the
  // store. This avoids any setState-in-effect dance — derived render output.
  const [draft, setDraft] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const skipNextCommitRef = useRef(false);

  // Formula picker state
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerHandleRef = useRef<FormulaPickerHandle>(null);
  const [pickerPos, setPickerPos] = useState({ x: 0, y: 0 });
  const [pickerDismissed, setPickerDismissed] = useState(false);

  // Same trigger condition as in-cell editor (use-formula-picker.ts):
  // value starts with "=" and contains no "(".
  const pickerShouldShow =
    isFocused &&
    !pickerDismissed &&
    draft.startsWith("=") &&
    !draft.includes("(");
  const pickerQuery = pickerShouldShow ? draft.substring(1) : "";

  const inputValue = isFocused ? draft : value;
  const cellLabel = binding && selection ? binding.cellNameAt(selection.row, selection.col) : "";
  const disabled = !binding || !selection || isEditing;

  const recomputePickerPos = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPickerPos({ x: r.left, y: r.bottom + 2 });
  };

  const commit = () => {
    if (!binding || !selection) return;
    if (draft === value) return;
    binding.setRawCellValue(selection.row, selection.col, draft);
  };

  const insertFormula = (name: string) => {
    const next = `=${name}(`;
    setDraft(next);
    setPickerDismissed(true);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
    });
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
        value={inputValue}
        disabled={disabled}
        placeholder={selection ? "" : "Select a cell"}
        onChange={(e) => {
          setDraft(e.target.value);
          setPickerDismissed(false);
          recomputePickerPos();
        }}
        onFocus={() => {
          setDraft(value);
          setIsFocused(true);
          setPickerDismissed(false);
          recomputePickerPos();
        }}
        onBlur={() => {
          if (skipNextCommitRef.current) {
            skipNextCommitRef.current = false;
          } else {
            commit();
          }
          setIsFocused(false);
        }}
        onKeyDown={(e) => {
          // When the picker is open, intercept navigation/commit keys.
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
        }}
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
