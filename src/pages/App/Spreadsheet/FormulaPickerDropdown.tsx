import { cn } from "@/lib/utils";
import {
  filterFormulas,
  type FormulaDefinition,
} from "@/lib/spreadsheet-formulas";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface FormulaPickerHandle {
  /** Process a keyboard event. Returns the selected formula name on Enter, null otherwise. */
  handleKey: (key: "ArrowUp" | "ArrowDown" | "Enter") => string | null;
}

interface FormulaPickerDropdownProps {
  position: { x: number; y: number };
  query: string;
  onSelect: (formulaName: string) => void;
  onDismiss: () => void;
  visible: boolean;
}

const DROPDOWN_MAX_HEIGHT = 224; // max-h-56 = 14rem

export const FormulaPickerDropdown = forwardRef<
  FormulaPickerHandle,
  FormulaPickerDropdownProps
>(function FormulaPickerDropdown({ position, query, onSelect, visible }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [trackedQuery, setTrackedQuery] = useState(query);
  const listRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => filterFormulas(query), [query]);

  // Reset selection when query changes (adjust state during render)
  if (trackedQuery !== query) {
    setTrackedQuery(query);
    setSelectedIndex(0);
  }

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useImperativeHandle(ref, () => ({
    handleKey(key) {
      if (matches.length === 0) return null;
      if (key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % matches.length);
        return null;
      }
      if (key === "ArrowUp") {
        setSelectedIndex((i) => (i - 1 + matches.length) % matches.length);
        return null;
      }
      if (key === "Enter") {
        return matches[selectedIndex]?.name ?? null;
      }
      return null;
    },
  }));

  if (!visible || matches.length === 0) return null;

  // Viewport boundary: flip above cell if dropdown would overflow bottom
  const flipped =
    position.y + DROPDOWN_MAX_HEIGHT > window.innerHeight;
  const adjustedY = flipped
    ? Math.max(0, position.y - DROPDOWN_MAX_HEIGHT - 4)
    : position.y;

  return createPortal(
    <div
      ref={listRef}
      className="fixed z-[60] max-h-56 w-72 overflow-y-auto rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ top: adjustedY, left: position.x }}
    >
      {matches.map((formula: FormulaDefinition, i: number) => (
        <button
          key={formula.name}
          type="button"
          className={cn(
            "flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-sm outline-none",
            i === selectedIndex
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50",
          )}
          onMouseDown={(e) => {
            e.preventDefault(); // Prevent textarea blur
            onSelect(formula.name);
          }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <div className="flex items-baseline gap-2">
            <span className="font-medium">{formula.name}</span>
            <span className="text-[10px] text-muted-foreground/70 font-mono">
              {formula.syntax}
            </span>
          </div>
          <span className="text-xs text-muted-foreground truncate">
            {formula.description}
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
});
