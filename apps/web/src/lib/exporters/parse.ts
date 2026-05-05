// Parse BlockNote's loosely-typed block tree into the strongly-typed
// `ExportBlock` AST. This is the only place that touches raw block/inline
// data — format renderers consume `ExportBlock[]` exclusively.

import type {
  ExportBlock,
  ExportInline,
  HeadingLevel,
  IncomingBlock,
  InlineStyles,
  TextAlign,
} from "./types";

// ---------------------------------------------------------------------------
// Narrow primitives
// ---------------------------------------------------------------------------

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asTextAlign(value: unknown): TextAlign | undefined {
  return value === "left" || value === "center" || value === "right" || value === "justify"
    ? value
    : undefined;
}

function asHeadingLevel(value: unknown): HeadingLevel {
  const n = typeof value === "number" ? value : Number(value);
  if (n === 1 || n === 2 || n === 3 || n === 4 || n === 5 || n === 6) return n;
  return 1;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

function parseStyles(raw: unknown): InlineStyles {
  const r = asRecord(raw);
  return {
    bold: asBoolean(r.bold),
    italic: asBoolean(r.italic),
    underline: asBoolean(r.underline),
    strike: asBoolean(r.strike),
    code: asBoolean(r.code),
  };
}

export function parseInline(content: unknown): ExportInline[] {
  if (typeof content === "string") {
    return [{ kind: "text", text: content, styles: parseStyles(undefined) }];
  }
  if (!Array.isArray(content)) return [];
  const out: ExportInline[] = [];
  for (const raw of content) {
    if (raw == null) continue;
    if (typeof raw === "string") {
      out.push({ kind: "text", text: raw, styles: parseStyles(undefined) });
      continue;
    }
    const item = asRecord(raw);
    const type = asString(item.type);
    if (type === "text") {
      out.push({
        kind: "text",
        text: asString(item.text),
        styles: parseStyles(item.styles),
      });
    } else if (type === "link") {
      out.push({
        kind: "link",
        href: asString(item.href),
        children: parseInline(item.content),
      });
    } else if (type === "mention") {
      const props = asRecord(item.props);
      const userId = asString(props.userId) || asString(props.user);
      if (userId) out.push({ kind: "mention", userId });
    } else if (type === "spreadsheetLink") {
      const props = asRecord(item.props);
      out.push({ kind: "sheetLink", spreadsheetId: asString(props.spreadsheetId) });
    } else if (type === "spreadsheetCellRef") {
      const props = asRecord(item.props);
      out.push({
        kind: "sheetCellRef",
        spreadsheetId: asString(props.spreadsheetId),
        cellRef: asString(props.cellRef),
        stableRef: asString(props.stableRef),
      });
    }
  }
  return out;
}

/** Plain-text projection of an inline run. Used for code blocks (which carry
 *  text inside their `content` field as styled inlines). */
export function inlineToPlainText(inline: ExportInline[]): string {
  let out = "";
  for (const item of inline) {
    if (item.kind === "text") out += item.text;
    else if (item.kind === "link") out += inlineToPlainText(item.children);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tables (BlockNote's `table` block content shape)
// ---------------------------------------------------------------------------

function parseTableRows(content: unknown): ExportInline[][][] {
  const c = asRecord(content);
  const rawRows = asArray(c.rows);
  return rawRows.map((rawRow) => {
    const row = asRecord(rawRow);
    const rawCells = asArray(row.cells);
    return rawCells.map((rawCell) => {
      // Cells may be plain inline arrays or `{ content: inline[] }` objects.
      if (Array.isArray(rawCell)) return parseInline(rawCell);
      const cell = asRecord(rawCell);
      return parseInline(cell.content);
    });
  });
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function parseBlock(raw: IncomingBlock): ExportBlock {
  const props = asRecord(raw.props);
  const align = asTextAlign(props.textAlignment);
  const children = parseBlocks(raw.children ?? []);

  switch (raw.type) {
    case "paragraph":
      return { kind: "paragraph", content: parseInline(raw.content), align, children };
    case "heading":
      return {
        kind: "heading",
        level: asHeadingLevel(props.level),
        content: parseInline(raw.content),
        align,
        children,
      };
    case "bulletListItem":
      return { kind: "bulletItem", content: parseInline(raw.content), align, children };
    case "numberedListItem":
      return { kind: "numberedItem", content: parseInline(raw.content), align, children };
    case "checkListItem":
      return {
        kind: "checkItem",
        checked: asBoolean(props.checked),
        content: parseInline(raw.content),
        align,
        children,
      };
    case "codeBlock": {
      // BlockNote stores code text as inlines; flatten to a single string.
      const text = inlineToPlainText(parseInline(raw.content));
      return { kind: "codeBlock", language: asString(props.language), text };
    }
    case "quote":
      return { kind: "quote", content: parseInline(raw.content), align, children };
    case "table":
      return { kind: "table", rows: parseTableRows(raw.content) };
    case "image":
      return {
        kind: "image",
        url: asString(props.url),
        caption: asString(props.caption),
      };
    case "diagram":
      return { kind: "diagram", diagramId: asString(props.diagramId) };
    case "spreadsheetRange":
      return {
        kind: "spreadsheetRange",
        spreadsheetId: asString(props.spreadsheetId),
        cellRef: asString(props.cellRef),
        stableRef: asString(props.stableRef),
        showHeaders: asBoolean(props.showHeaders, true),
      };
    case "documentBlockEmbed":
      return {
        kind: "documentBlockEmbed",
        documentId: asString(props.documentId),
        blockId: asString(props.blockId),
      };
    default:
      return {
        kind: "unknown",
        type: raw.type,
        content: parseInline(raw.content),
        children,
      };
  }
}

export function parseBlocks(blocks: readonly IncomingBlock[]): ExportBlock[] {
  return blocks.map(parseBlock);
}
