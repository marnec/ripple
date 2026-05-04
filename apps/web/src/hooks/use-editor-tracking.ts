import { useEffect, useEffectEvent, useRef } from "react";

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

  // useEffectEvent captures the latest option values without forcing
  // them into the effect's dependency array.
  const handleRemoved = useEffectEvent((removed: Set<string>) => {
    options?.onRemoved?.(removed);
  });
  const handleChanged = useEffectEvent(
    (current: Set<string>, previous: Set<string>) => {
      options?.onChanged?.(current, previous);
    },
  );
  const hasOnRemoved = useEffectEvent(() => options?.onRemoved != null);
  const hasOnChanged = useEffectEvent(() => options?.onChanged != null);
  const getSyncOnMount = useEffectEvent(() => options?.syncOnMount ?? false);

  const debounceMs = options?.debounceMs ?? 2000;

  useEffect(() => {
    if (!editor) return;

    const initial = extract(editor.document);
    prevRef.current = initial;

    // Optionally sync on mount (e.g. embed tracking needs to register pre-existing refs)
    if (getSyncOnMount() && initial.size > 0) {
      handleChanged(initial, new Set());
    }

    const unsubscribe = editor.onChange(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const current = extract(editor.document);
        const prev = prevRef.current;

        // Removals
        if (hasOnRemoved()) {
          const removed = new Set<string>();
          for (const key of prev) {
            if (!current.has(key)) removed.add(key);
          }
          if (removed.size > 0) handleRemoved(removed);
        }

        // Full-set change
        if (hasOnChanged()) {
          const changed =
            current.size !== prev.size ||
            [...current].some((k) => !prev.has(k));
          if (changed) handleChanged(current, prev);
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

/** Extract all hard-embed reference keys (diagram blocks, spreadsheet refs, document block embeds) from the editor document tree. */
export function extractHardEmbeds(blocks: unknown[]): Set<string> {
  const refs = new Set<string>();
  for (const block of blocks as EditorBlock[]) {
    if (block.type === "diagram" && block.props?.diagramId) {
      refs.add(`diagram|${block.props.diagramId}`);
    }
    if (block.type === "spreadsheetRange" && block.props?.spreadsheetId) {
      refs.add(`spreadsheet|${block.props.spreadsheetId}`);
    }
    if (block.type === "documentBlockEmbed" && block.props?.documentId) {
      refs.add(`document|${block.props.documentId}`);
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

/** Extract all documentBlockEmbed keys (documentId|blockId) from the editor document tree. */
export function extractDocBlockRefs(blocks: unknown[]): Set<string> {
  const refs = new Set<string>();
  for (const block of blocks as EditorBlock[]) {
    if (block.type === "documentBlockEmbed" && block.props?.documentId && block.props?.blockId) {
      refs.add(`${block.props.documentId}|${block.props.blockId}`);
    }
    if (block.children) {
      for (const key of extractDocBlockRefs(block.children)) {
        refs.add(key);
      }
    }
  }
  return refs;
}

/** Collect mention userIds from a list of inline nodes. */
function collectInlineMentions(nodes: InlineNode[], refs: Set<string>) {
  for (const ic of nodes) {
    if (ic.type === "mention" && ic.props?.userId) {
      refs.add(ic.props.userId);
    }
  }
}

/** Extract all @mention user IDs from the editor document tree. */
export function extractMentions(blocks: unknown[]): Set<string> {
  const refs = new Set<string>();
  for (const block of blocks as EditorBlock[]) {
    if (Array.isArray(block.content)) {
      collectInlineMentions(block.content, refs);
    }
    if (block.content && !Array.isArray(block.content) && block.content.type === "tableContent") {
      for (const row of block.content.rows) {
        for (const cell of row.cells) {
          collectInlineMentions(cell.content, refs);
        }
      }
    }
    if (block.children) {
      for (const key of extractMentions(block.children)) {
        refs.add(key);
      }
    }
  }
  return refs;
}

/** Collect cell ref keys from a list of inline nodes.
 *  Key shape: `<spreadsheetId>|<stableRef>`. Refs without a stableRef
 *  (which shouldn't exist post-Phase-B) are skipped — their cache row
 *  can't be cleaned up via this path. */
function collectInlineCellRefs(nodes: InlineNode[], refs: Set<string>) {
  for (const ic of nodes) {
    if (
      ic.type === "spreadsheetCellRef" &&
      ic.props?.spreadsheetId &&
      ic.props?.stableRef
    ) {
      refs.add(`${ic.props.spreadsheetId}|${ic.props.stableRef}`);
    }
  }
}

/** Extract all spreadsheetCellRef keys (`<spreadsheetId>|<stableRef>`) from
 *  the editor document tree. */
export function extractCellRefs(blocks: unknown[]): Set<string> {
  const refs = new Set<string>();
  for (const block of blocks as EditorBlock[]) {
    if (
      block.type === "spreadsheetRange" &&
      block.props?.spreadsheetId &&
      block.props?.stableRef
    ) {
      refs.add(`${block.props.spreadsheetId}|${block.props.stableRef}`);
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
