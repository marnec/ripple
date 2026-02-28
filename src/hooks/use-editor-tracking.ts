import { useEffect, useRef } from "react";

/** Minimal editor shape required by useEditorTracking. */
type TrackableEditor = {
  document: unknown[];
  onChange: (cb: () => void) => () => void;
};

/**
 * Subscribes to `editor.onChange`, debounces, extracts a `Set<string>` via
 * `extract`, diffs against the previous set, and fires callbacks for
 * additions, removals, and the full set when changed.
 *
 * Used to sync editor-embedded references (cell refs, diagrams, spreadsheets)
 * to external stores without duplicating the subscribe→debounce→diff pattern.
 */
export function useEditorTracking(
  editor: TrackableEditor | null,
  extract: (blocks: unknown[]) => Set<string>,
  options?: {
    onRemoved?: (keys: Set<string>) => void;
    onChanged?: (current: Set<string>, previous: Set<string>) => void;
    /** Run onChanged on mount if initial set is non-empty. Default false. */
    syncOnMount?: boolean;
    debounceMs?: number;
  },
): void {
  const prevRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep callbacks in refs so effect deps stay stable
  const onRemovedRef = useRef(options?.onRemoved);
  onRemovedRef.current = options?.onRemoved;
  const onChangedRef = useRef(options?.onChanged);
  onChangedRef.current = options?.onChanged;
  const syncOnMountRef = useRef(options?.syncOnMount);
  syncOnMountRef.current = options?.syncOnMount;

  const debounceMs = options?.debounceMs ?? 2000;

  useEffect(() => {
    if (!editor) return;

    const initial = extract(editor.document);
    prevRef.current = initial;

    // Optionally sync on mount (e.g. embed tracking needs to register pre-existing refs)
    if (syncOnMountRef.current && initial.size > 0) {
      onChangedRef.current?.(initial, new Set());
    }

    const unsubscribe = editor.onChange(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const current = extract(editor.document);
        const prev = prevRef.current;

        // Removals
        if (onRemovedRef.current) {
          const removed = new Set<string>();
          for (const key of prev) {
            if (!current.has(key)) removed.add(key);
          }
          if (removed.size > 0) onRemovedRef.current(removed);
        }

        // Full-set change
        if (onChangedRef.current) {
          const changed =
            current.size !== prev.size ||
            [...current].some((k) => !prev.has(k));
          if (changed) onChangedRef.current(current, prev);
        }

        prevRef.current = current;
      }, debounceMs);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // extract is expected to be a stable module-level function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, debounceMs]);
}

// ── BlockNote document tree types ────────────────────────────────────

/** Inline content node within a BlockNote block (e.g. mention, cell ref, link). */
interface InlineNode {
  type: string;
  props?: Record<string, string>;
}

/** Table content shape nested inside a table block. */
interface TableContent {
  type: "tableContent";
  rows: Array<{ cells: Array<{ content: InlineNode[] }> }>;
}

/** A single block in the BlockNote document tree. */
interface EditorBlock {
  type: string;
  props?: Record<string, string>;
  content?: InlineNode[] | TableContent;
  children?: EditorBlock[];
}

// ── Pure extractors ──────────────────────────────────────────────────

/** Collect inline refs matching spreadsheet types from a list of inline nodes. */
function collectInlineSpreadsheetRefs(nodes: InlineNode[], refs: Set<string>) {
  for (const ic of nodes) {
    if (ic.type === "spreadsheetCellRef" && ic.props?.spreadsheetId) {
      refs.add(`spreadsheet|${ic.props.spreadsheetId}`);
    }
    if (ic.type === "spreadsheetLink" && ic.props?.spreadsheetId) {
      refs.add(`spreadsheet|${ic.props.spreadsheetId}`);
    }
  }
}

/** Extract all hard-embed reference keys (diagram blocks, spreadsheet refs) from the editor document tree. */
export function extractHardEmbeds(blocks: unknown[]): Set<string> {
  const refs = new Set<string>();
  for (const block of blocks as EditorBlock[]) {
    if (block.type === "diagram" && block.props?.diagramId) {
      refs.add(`diagram|${block.props.diagramId}`);
    }
    if (block.type === "spreadsheetRange" && block.props?.spreadsheetId) {
      refs.add(`spreadsheet|${block.props.spreadsheetId}`);
    }
    if (Array.isArray(block.content)) {
      collectInlineSpreadsheetRefs(block.content, refs);
    }
    if (block.content && !Array.isArray(block.content) && block.content.type === "tableContent") {
      for (const row of block.content.rows) {
        for (const cell of row.cells) {
          collectInlineSpreadsheetRefs(cell.content, refs);
        }
      }
    }
    if (block.children) {
      for (const key of extractHardEmbeds(block.children)) {
        refs.add(key);
      }
    }
  }
  return refs;
}

/** Collect cell ref keys from a list of inline nodes. */
function collectInlineCellRefs(nodes: InlineNode[], refs: Set<string>) {
  for (const ic of nodes) {
    if (ic.type === "spreadsheetCellRef" && ic.props) {
      refs.add(`${ic.props.spreadsheetId}|${ic.props.cellRef}`);
    }
  }
}

/** Extract all spreadsheetCellRef keys from the editor document tree. */
export function extractCellRefs(blocks: unknown[]): Set<string> {
  const refs = new Set<string>();
  for (const block of blocks as EditorBlock[]) {
    if (block.type === "spreadsheetRange" && block.props?.spreadsheetId && block.props?.cellRef) {
      refs.add(`${block.props.spreadsheetId}|${block.props.cellRef}`);
    }
    if (Array.isArray(block.content)) {
      collectInlineCellRefs(block.content, refs);
    }
    if (block.content && !Array.isArray(block.content) && block.content.type === "tableContent") {
      for (const row of block.content.rows) {
        for (const cell of row.cells) {
          collectInlineCellRefs(cell.content, refs);
        }
      }
    }
    if (block.children) {
      for (const key of extractCellRefs(block.children)) {
        refs.add(key);
      }
    }
  }
  return refs;
}
