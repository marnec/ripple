// Typed AST shared by all document exporters. The block walker takes
// `ExportBlock[]` (produced by `parse.ts` from BlockNote's untyped block tree)
// so format-specific renderers never touch raw, untyped block data.

export type TextAlign = "left" | "center" | "right" | "justify";
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface InlineStyles {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
}

export type ExportInline =
  | { kind: "text"; text: string; styles: InlineStyles }
  | { kind: "link"; href: string; children: ExportInline[] }
  | { kind: "mention"; userId: string }
  | { kind: "sheetLink"; spreadsheetId: string }
  | { kind: "sheetCellRef"; spreadsheetId: string; cellRef: string; stableRef: string };

export type ExportBlock =
  | BaseBlock<"paragraph">
  | (BaseBlock<"heading"> & { level: HeadingLevel })
  | BaseBlock<"bulletItem">
  | BaseBlock<"numberedItem">
  | (BaseBlock<"checkItem"> & { checked: boolean })
  | { kind: "codeBlock"; language: string; text: string }
  | BaseBlock<"quote">
  | { kind: "table"; rows: ExportInline[][][] }
  | { kind: "image"; url: string; caption: string }
  | { kind: "diagram"; diagramId: string }
  | {
    kind: "spreadsheetRange";
    spreadsheetId: string;
    cellRef: string;
    stableRef: string;
    showHeaders: boolean;
  }
  | { kind: "documentBlockEmbed"; documentId: string; blockId: string }
  | { kind: "unknown"; type: string; content: ExportInline[]; children: ExportBlock[] };

interface BaseBlock<K extends string> {
  kind: K;
  content: ExportInline[];
  align?: TextAlign;
  children: ExportBlock[];
}

// ---------------------------------------------------------------------------
// Export context — pre-resolved data needed by renderers
// ---------------------------------------------------------------------------

export interface DiagramEmbed {
  /** SVG markup with responsive sizing — drop-in for HTML. */
  svgHtml: string;
  /** Base64-encoded SVG XML for Markdown `data:` URLs. */
  svgBase64: string;
  /** Rasterized PNG with original pixel dimensions for DOCX `ImageRun`.
   *  Undefined when canvas rasterization fails. */
  png?: { bytes: Uint8Array; width: number; height: number };
}

export interface ExportContext {
  diagramName(id: string): string | undefined;
  spreadsheetName(id: string): string | undefined;
  documentName(id: string): string | undefined;
  userName(id: string): string | undefined;
  /** Diagram render data keyed by diagramId. */
  diagram(id: string): DiagramEmbed | undefined;
  /** Resolved 2D cell values, keyed by stableRef. Used both by spreadsheetRange
   *  blocks (full grid) and inline spreadsheetCellRef items (single cell at [0][0]). */
  cells(stableRef: string): string[][] | undefined;
}

export const NULL_EXPORT_CONTEXT: ExportContext = {
  diagramName: () => undefined,
  spreadsheetName: () => undefined,
  documentName: () => undefined,
  userName: () => undefined,
  diagram: () => undefined,
  cells: () => undefined,
};

// ---------------------------------------------------------------------------
// Loose shape of the BlockNote block tree the parser accepts. Matches both
// standard blocks and Ripple's custom blocks; the parser narrows from here.
// ---------------------------------------------------------------------------

export interface IncomingBlock {
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: IncomingBlock[];
}
