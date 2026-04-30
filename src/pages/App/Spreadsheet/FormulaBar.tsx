import { Input } from "@/components/ui/input";
import type { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";
import { useRef, useState, useSyncExternalStore } from "react";

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

  const inputValue = isFocused ? draft : value;
  const cellLabel = binding && selection ? binding.cellNameAt(selection.row, selection.col) : "";
  const disabled = !binding || !selection || isEditing;

  const commit = () => {
    if (!binding || !selection) return;
    if (draft === value) return;
    binding.setRawCellValue(selection.row, selection.col, draft);
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
        type="text"
        value={inputValue}
        disabled={disabled}
        placeholder={selection ? "" : "Select a cell"}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          setDraft(value);
          setIsFocused(true);
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
    </div>
  );
}
