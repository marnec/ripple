import type { BlockNoteEditor } from "@blocknote/core";
import type { ConvexReactClient } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sanitizeFilename, triggerDownload } from "@/lib/download-blob";
import {
  bytesToBase64,
  fetchDiagramSvgElement,
  fetchSpreadsheetCells,
  svgElementToPngBytes,
  svgElementToResponsiveString,
} from "./embed-resolvers";

type AnyEditor = BlockNoteEditor<any, any, any>;

/** Pre-resolved diagram embed data, computed once during export and reused
 *  across HTML/Markdown/DOCX renderers. */
export interface DiagramEmbed {
  /** SVG markup with responsive sizing — drop-in for HTML. */
  svgHtml: string;
  /** Base64-encoded SVG XML for Markdown `data:` URLs. */
  svgBase64: string;
  /** Rasterized PNG with original pixel dimensions for DOCX `ImageRun`.
   *  Undefined when canvas rasterization fails (e.g. tainted SVG). */
  png?: { bytes: Uint8Array; width: number; height: number };
}

export interface ExportContext {
  diagramName(id: string): string | undefined;
  spreadsheetName(id: string): string | undefined;
  documentName(id: string): string | undefined;
  userName(id: string): string | undefined;
  /** Diagram render data keyed by diagramId. */
  diagram(id: string): DiagramEmbed | undefined;
  /** Resolved 2D cell values for a `spreadsheetRange`, keyed by stableRef. */
  spreadsheetCells(stableRef: string): string[][] | undefined;
}

const NULL_CONTEXT: ExportContext = {
  diagramName: () => undefined,
  spreadsheetName: () => undefined,
  documentName: () => undefined,
  userName: () => undefined,
  diagram: () => undefined,
  spreadsheetCells: () => undefined,
};

function shortId(id: unknown): string {
  const s = typeof id === "string" ? id : "";
  return s.length > 8 ? s.slice(-6) : s;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeMd(text: string): string {
  return text.replace(/([\\`*_{}\[\]()#+\-.!|])/g, "\\$1");
}

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------

export function exportDocumentMarkdown(editor: AnyEditor, name: string, ctx: ExportContext = NULL_CONTEXT): void {
  const md = blocksToMarkdown(editor.document as any[], ctx, 0);
  triggerDownload(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${sanitizeFilename(name)}.md`);
}

function blocksToMarkdown(blocks: any[], ctx: ExportContext, listLevel: number): string {
  let out = "";
  let numberedIndex = 1;
  let prevType: string | null = null;
  for (const block of blocks) {
    if (!block) continue;
    if (block.type === "numberedListItem" && prevType !== "numberedListItem") numberedIndex = 1;
    out += blockToMarkdown(block, ctx, listLevel, numberedIndex);
    if (block.type === "numberedListItem") numberedIndex++;
    prevType = block.type;
  }
  return out;
}

function blockToMarkdown(block: any, ctx: ExportContext, listLevel: number, numberedIndex: number): string {
  const indent = "  ".repeat(listLevel);
  const inline = inlineContentToMarkdown(block.content, ctx);
  let out = "";
  switch (block.type) {
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(block.props?.level ?? 1)));
      out = `${"#".repeat(level)} ${inline}\n\n`;
      break;
    }
    case "paragraph": {
      out = `${inline}\n\n`;
      break;
    }
    case "bulletListItem": {
      out = `${indent}- ${inline}\n`;
      break;
    }
    case "numberedListItem": {
      out = `${indent}${numberedIndex}. ${inline}\n`;
      break;
    }
    case "checkListItem": {
      const checked = Boolean(block.props?.checked);
      out = `${indent}- [${checked ? "x" : " "}] ${inline}\n`;
      break;
    }
    case "codeBlock": {
      const lang = String(block.props?.language ?? "");
      const text = inlineRunsToPlainText(block.content);
      out = `\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
      break;
    }
    case "quote": {
      out = `> ${inline}\n\n`;
      break;
    }
    case "table": {
      out = nativeTableToMarkdown(block, ctx) + "\n";
      break;
    }
    case "image": {
      const url = String(block.props?.url ?? "");
      const caption = String(block.props?.caption ?? "");
      out = url ? `![${escapeMd(caption)}](${url})\n\n` : "";
      break;
    }
    case "spreadsheetRange": {
      out = spreadsheetRangeToMarkdown(block, ctx) + "\n";
      break;
    }
    case "diagram": {
      out = diagramToMarkdown(block, ctx) + "\n";
      break;
    }
    case "documentBlockEmbed": {
      const id = String(block.props?.documentId ?? "");
      const name = id ? ctx.documentName(id) : undefined;
      const docLabel = name ?? (id ? shortId(id) : "document");
      out = `> _Embedded block from ${escapeMd(docLabel)}_\n\n`;
      break;
    }
    default: {
      if (inline.trim()) out = `${inline}\n\n`;
      break;
    }
  }
  if (Array.isArray(block.children) && block.children.length > 0) {
    out += blocksToMarkdown(block.children, ctx, listLevel + 1);
  }
  return out;
}

function nativeTableToMarkdown(block: any, ctx: ExportContext): string {
  const rows: any[] = block.content?.rows ?? [];
  if (rows.length === 0) return "";
  const cellText = (cell: any): string => {
    const inline = Array.isArray(cell) ? cell : (cell?.content ?? []);
    return inlineContentToMarkdown(inline, ctx).replace(/\|/g, "\\|").replace(/\n/g, " ");
  };
  const lines: string[] = [];
  rows.forEach((row, i) => {
    const cells: any[] = row.cells ?? [];
    lines.push(`| ${cells.map(cellText).join(" | ")} |`);
    if (i === 0) {
      lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    }
  });
  return lines.join("\n") + "\n";
}

function spreadsheetRangeToMarkdown(block: any, ctx: ExportContext): string {
  const stableRef = String(block.props?.stableRef ?? "");
  const cells = stableRef ? ctx.spreadsheetCells(stableRef) : undefined;
  const sheetId = String(block.props?.spreadsheetId ?? "");
  const sheetName = sheetId ? ctx.spreadsheetName(sheetId) : undefined;
  const cellRef = String(block.props?.cellRef ?? "");
  const showHeaders = Boolean(block.props?.showHeaders ?? true);
  const caption = `_${escapeMd(`${sheetName ?? sheetId.slice(-6) ?? "spreadsheet"}${cellRef ? ` · ${cellRef}` : ""}`)}_`;
  if (!cells || cells.length === 0) {
    return `${caption}\n\n_Range data unavailable_\n`;
  }
  const escapeCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines: string[] = [];
  if (showHeaders) {
    const header = cells[0];
    if (!header) return `${caption}\n\n_Range data unavailable_\n`;
    lines.push(`| ${header.map(escapeCell).join(" | ")} |`);
    lines.push(`| ${header.map(() => "---").join(" | ")} |`);
    for (let i = 1; i < cells.length; i++) {
      const row = cells[i];
      if (!row) continue;
      lines.push(`| ${row.map(escapeCell).join(" | ")} |`);
    }
  } else {
    const cols = cells[0]?.length ?? 0;
    lines.push(`| ${Array.from({ length: cols }, (_, i) => `Col ${i + 1}`).join(" | ")} |`);
    lines.push(`| ${Array.from({ length: cols }, () => "---").join(" | ")} |`);
    for (const row of cells) {
      lines.push(`| ${row.map(escapeCell).join(" | ")} |`);
    }
  }
  return `${caption}\n\n${lines.join("\n")}\n`;
}

function diagramToMarkdown(block: any, ctx: ExportContext): string {
  const id = String(block.props?.diagramId ?? "");
  const name = id ? ctx.diagramName(id) : undefined;
  const label = name ?? (id ? shortId(id) : "diagram");
  const embed = id ? ctx.diagram(id) : undefined;
  if (embed) {
    return `![${escapeMd(label)}](data:image/svg+xml;base64,${embed.svgBase64})\n`;
  }
  return `_[Diagram: ${escapeMd(label)}]_\n`;
}

function inlineContentToMarkdown(content: unknown, ctx: ExportContext): string {
  if (typeof content === "string") return escapeMd(content);
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const item of content) {
    if (item == null) continue;
    if (typeof item === "string") {
      out += escapeMd(item);
      continue;
    }
    if (item.type === "text" && typeof item.text === "string") {
      const styles = item.styles ?? {};
      let text = escapeMd(item.text);
      if (styles.code) text = `\`${item.text}\``;
      if (styles.bold) text = `**${text}**`;
      if (styles.italic) text = `*${text}*`;
      if (styles.strike) text = `~~${text}~~`;
      out += text;
      continue;
    }
    if (item.type === "link" && Array.isArray(item.content)) {
      const inner = inlineContentToMarkdown(item.content, ctx);
      const href = String(item.href ?? "");
      out += `[${inner}](${href})`;
      continue;
    }
    if (item.type === "mention") {
      const userId = String(item.props?.userId ?? item.props?.user ?? "");
      const resolved = userId ? ctx.userName(userId) : undefined;
      out += `@${escapeMd(resolved ?? (userId ? shortId(userId) : "user"))}`;
      continue;
    }
    if (item.type === "spreadsheetLink") {
      const id = String(item.props?.spreadsheetId ?? "");
      const resolved = id ? ctx.spreadsheetName(id) : undefined;
      out += `\`${resolved ?? (id ? shortId(id) : "spreadsheet")}\``;
      continue;
    }
    if (item.type === "spreadsheetCellRef") {
      const id = String(item.props?.spreadsheetId ?? "");
      const cellRef = String(item.props?.cellRef ?? "");
      const stableRef = String(item.props?.stableRef ?? "");
      const value = stableRef ? ctx.spreadsheetCells(stableRef)?.[0]?.[0] : undefined;
      const resolved = id ? ctx.spreadsheetName(id) : undefined;
      const sheetLabel = resolved ?? (id ? shortId(id) : "spreadsheet");
      out += value !== undefined
        ? `${escapeMd(value)} _(${escapeMd(cellRef || "?")} @ ${escapeMd(sheetLabel)})_`
        : `\`${cellRef || "?"}\` _(${escapeMd(sheetLabel)})_`;
      continue;
    }
  }
  return out;
}

function inlineRunsToPlainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item: any) => {
    if (typeof item === "string") return item;
    if (item?.type === "text") return String(item.text ?? "");
    if (item?.type === "link" && Array.isArray(item.content)) return inlineRunsToPlainText(item.content);
    return "";
  }).join("");
}

// ---------------------------------------------------------------------------
// HTML export
// ---------------------------------------------------------------------------

const HTML_STYLES = `
body { font-family: system-ui, -apple-system, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #222; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.6em; }
p { margin: 0 0 1em; }
ul, ol { padding-left: 1.5rem; margin: 0 0 1em; }
li { margin-bottom: 0.25em; }
blockquote { border-left: 3px solid #ddd; padding: 0.2em 1em; color: #555; margin: 1em 0; }
pre { background: #f5f5f5; padding: 0.8rem; border-radius: 6px; overflow-x: auto; }
code { background: #f5f5f5; padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.92em; }
pre code { background: transparent; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
table th, table td { border: 1px solid #ccc; padding: 0.4em 0.6em; text-align: left; vertical-align: top; }
table th { background: #fafafa; }
.embed { margin: 1.2em 0; }
.embed-caption { font-size: 0.85em; color: #777; margin-top: 0.3em; }
img, svg { max-width: 100%; height: auto; }
`.trim();

export function exportDocumentHTML(editor: AnyEditor, name: string, ctx: ExportContext = NULL_CONTEXT): void {
  const body = blocksToHtml(editor.document as any[], ctx);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(name)}</title>
<style>${HTML_STYLES}</style>
</head>
<body>
<h1>${escapeHtml(name)}</h1>
${body}
</body>
</html>`;
  triggerDownload(new Blob([html], { type: "text/html;charset=utf-8" }), `${sanitizeFilename(name)}.html`);
}

function blocksToHtml(blocks: any[], ctx: ExportContext): string {
  // Group consecutive list items so we can wrap them in <ul>/<ol>.
  let html = "";
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (!block) { i++; continue; }
    if (block.type === "bulletListItem" || block.type === "numberedListItem") {
      const tag = block.type === "bulletListItem" ? "ul" : "ol";
      let items = "";
      while (i < blocks.length && blocks[i]?.type === block.type) {
        items += listItemToHtml(blocks[i], ctx);
        i++;
      }
      html += `<${tag}>${items}</${tag}>`;
    } else if (block.type === "checkListItem") {
      let items = "";
      while (i < blocks.length && blocks[i]?.type === "checkListItem") {
        const checked = blocks[i].props?.checked ? " checked" : "";
        const inline = inlineContentToHtml(blocks[i].content, ctx);
        const children = Array.isArray(blocks[i].children) && blocks[i].children.length > 0
          ? blocksToHtml(blocks[i].children, ctx)
          : "";
        items += `<li><input type="checkbox" disabled${checked}> ${inline}${children}</li>`;
        i++;
      }
      html += `<ul>${items}</ul>`;
    } else {
      html += blockToHtml(block, ctx);
      i++;
    }
  }
  return html;
}

function listItemToHtml(block: any, ctx: ExportContext): string {
  const inline = inlineContentToHtml(block.content, ctx);
  const children = Array.isArray(block.children) && block.children.length > 0
    ? blocksToHtml(block.children, ctx)
    : "";
  return `<li>${inline}${children}</li>`;
}

function blockToHtml(block: any, ctx: ExportContext): string {
  const inline = inlineContentToHtml(block.content, ctx);
  const align = String(block.props?.textAlignment ?? "");
  const styleAttr = align && align !== "left" ? ` style="text-align:${escapeHtml(align)}"` : "";
  let out = "";
  switch (block.type) {
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(block.props?.level ?? 1)));
      out = `<h${level}${styleAttr}>${inline}</h${level}>`;
      break;
    }
    case "paragraph": {
      out = `<p${styleAttr}>${inline}</p>`;
      break;
    }
    case "codeBlock": {
      const lang = String(block.props?.language ?? "");
      const text = inlineRunsToPlainText(block.content);
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out = `<pre><code${langAttr}>${escapeHtml(text)}</code></pre>`;
      break;
    }
    case "quote": {
      out = `<blockquote${styleAttr}>${inline}</blockquote>`;
      break;
    }
    case "table": {
      out = nativeTableToHtml(block, ctx);
      break;
    }
    case "image": {
      const url = String(block.props?.url ?? "");
      const caption = String(block.props?.caption ?? "");
      if (!url) break;
      const alt = escapeHtml(caption);
      out = `<figure class="embed"><img src="${escapeHtml(url)}" alt="${alt}">${caption ? `<figcaption class="embed-caption">${alt}</figcaption>` : ""}</figure>`;
      break;
    }
    case "spreadsheetRange": {
      out = spreadsheetRangeToHtml(block, ctx);
      break;
    }
    case "diagram": {
      out = diagramToHtml(block, ctx);
      break;
    }
    case "documentBlockEmbed": {
      const id = String(block.props?.documentId ?? "");
      const name = id ? ctx.documentName(id) : undefined;
      const docLabel = name ?? (id ? shortId(id) : "document");
      out = `<blockquote class="embed"><em>Embedded block from ${escapeHtml(docLabel)}</em></blockquote>`;
      break;
    }
    default: {
      if (inline.trim()) out = `<p${styleAttr}>${inline}</p>`;
      break;
    }
  }
  if (Array.isArray(block.children) && block.children.length > 0 && block.type !== "bulletListItem" && block.type !== "numberedListItem" && block.type !== "checkListItem") {
    out += blocksToHtml(block.children, ctx);
  }
  return out;
}

function nativeTableToHtml(block: any, ctx: ExportContext): string {
  const rows: any[] = block.content?.rows ?? [];
  if (rows.length === 0) return "";
  const renderCell = (cell: any) => {
    const inline = Array.isArray(cell) ? cell : (cell?.content ?? []);
    return inlineContentToHtml(inline, ctx);
  };
  const tr = rows.map((row: any) => {
    const cells: any[] = row.cells ?? [];
    return `<tr>${cells.map((c) => `<td>${renderCell(c)}</td>`).join("")}</tr>`;
  }).join("");
  return `<table>${tr}</table>`;
}

function spreadsheetRangeToHtml(block: any, ctx: ExportContext): string {
  const stableRef = String(block.props?.stableRef ?? "");
  const cells = stableRef ? ctx.spreadsheetCells(stableRef) : undefined;
  const sheetId = String(block.props?.spreadsheetId ?? "");
  const sheetName = sheetId ? ctx.spreadsheetName(sheetId) : undefined;
  const cellRef = String(block.props?.cellRef ?? "");
  const showHeaders = Boolean(block.props?.showHeaders ?? true);
  const caption = `${escapeHtml(sheetName ?? (sheetId ? shortId(sheetId) : "spreadsheet"))}${cellRef ? ` · ${escapeHtml(cellRef)}` : ""}`;
  if (!cells || cells.length === 0) {
    return `<figure class="embed"><table><tbody><tr><td><em>Range data unavailable</em></td></tr></tbody></table><figcaption class="embed-caption">${caption}</figcaption></figure>`;
  }
  let head = "";
  let bodyRows: string[][] = cells;
  const headerRow = cells[0];
  if (showHeaders && headerRow) {
    head = `<thead><tr>${headerRow.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
    bodyRows = cells.slice(1);
  }
  const tbody = `<tbody>${bodyRows.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<figure class="embed"><table>${head}${tbody}</table><figcaption class="embed-caption">${caption}</figcaption></figure>`;
}

function diagramToHtml(block: any, ctx: ExportContext): string {
  const id = String(block.props?.diagramId ?? "");
  const name = id ? ctx.diagramName(id) : undefined;
  const label = name ?? (id ? shortId(id) : "diagram");
  const embed = id ? ctx.diagram(id) : undefined;
  if (embed) {
    return `<figure class="embed">${embed.svgHtml}<figcaption class="embed-caption">${escapeHtml(label)}</figcaption></figure>`;
  }
  return `<figure class="embed"><em>[Diagram: ${escapeHtml(label)}]</em></figure>`;
}

function inlineContentToHtml(content: unknown, ctx: ExportContext): string {
  if (typeof content === "string") return escapeHtml(content);
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const item of content) {
    if (item == null) continue;
    if (typeof item === "string") { out += escapeHtml(item); continue; }
    if (item.type === "text" && typeof item.text === "string") {
      const styles = item.styles ?? {};
      let html = escapeHtml(item.text);
      if (styles.code) html = `<code>${html}</code>`;
      if (styles.bold) html = `<strong>${html}</strong>`;
      if (styles.italic) html = `<em>${html}</em>`;
      if (styles.underline) html = `<u>${html}</u>`;
      if (styles.strike) html = `<s>${html}</s>`;
      out += html;
      continue;
    }
    if (item.type === "link" && Array.isArray(item.content)) {
      const inner = inlineContentToHtml(item.content, ctx);
      out += `<a href="${escapeHtml(String(item.href ?? ""))}">${inner}</a>`;
      continue;
    }
    if (item.type === "mention") {
      const userId = String(item.props?.userId ?? item.props?.user ?? "");
      const resolved = userId ? ctx.userName(userId) : undefined;
      out += `<em>@${escapeHtml(resolved ?? (userId ? shortId(userId) : "user"))}</em>`;
      continue;
    }
    if (item.type === "spreadsheetLink") {
      const id = String(item.props?.spreadsheetId ?? "");
      const resolved = id ? ctx.spreadsheetName(id) : undefined;
      out += `<code>${escapeHtml(resolved ?? (id ? shortId(id) : "spreadsheet"))}</code>`;
      continue;
    }
    if (item.type === "spreadsheetCellRef") {
      const id = String(item.props?.spreadsheetId ?? "");
      const cellRef = String(item.props?.cellRef ?? "");
      const stableRef = String(item.props?.stableRef ?? "");
      const value = stableRef ? ctx.spreadsheetCells(stableRef)?.[0]?.[0] : undefined;
      const resolved = id ? ctx.spreadsheetName(id) : undefined;
      const sheetLabel = resolved ?? (id ? shortId(id) : "spreadsheet");
      out += value !== undefined
        ? `${escapeHtml(value)} <em>(${escapeHtml(cellRef || "?")} @ ${escapeHtml(sheetLabel)})</em>`
        : `<code>${escapeHtml(cellRef || "?")}</code> <em>(${escapeHtml(sheetLabel)})</em>`;
      continue;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// DOCX export
// ---------------------------------------------------------------------------

export async function exportDocumentDocx(editor: AnyEditor, name: string, ctx: ExportContext = NULL_CONTEXT): Promise<void> {
  const docx = await import("docx");
  const blocks = editor.document as any[];
  const paragraphs = blocksToDocxChildren(blocks, docx, 0, ctx);

  const doc = new docx.Document({
    sections: [{ properties: {}, children: paragraphs }],
    styles: {
      paragraphStyles: [
        { id: "code", name: "Code", run: { font: "Consolas", size: 20 } },
        { id: "caption", name: "Caption", run: { italics: true, size: 18, color: "666666" } },
      ],
    },
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            { level: 0, format: docx.LevelFormat.DECIMAL, text: "%1.", alignment: docx.AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
            { level: 1, format: docx.LevelFormat.LOWER_LETTER, text: "%2.", alignment: docx.AlignmentType.START, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
            { level: 2, format: docx.LevelFormat.LOWER_ROMAN, text: "%3.", alignment: docx.AlignmentType.START, style: { paragraph: { indent: { left: 2160, hanging: 360 } } } },
          ],
        },
      ],
    },
  });

  const blob = await docx.Packer.toBlob(doc);
  triggerDownload(blob, `${sanitizeFilename(name)}.docx`);
}

type DocxNode = import("docx").Paragraph | import("docx").Table;

function blocksToDocxChildren(blocks: any[], docx: typeof import("docx"), listLevel: number, ctx: ExportContext): DocxNode[] {
  const out: DocxNode[] = [];
  for (const block of blocks) {
    out.push(...blockToDocxElements(block, docx, listLevel, ctx));
  }
  return out;
}

function blockToDocxElements(block: any, docx: typeof import("docx"), listLevel: number, ctx: ExportContext): DocxNode[] {
  const { Paragraph, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, TextRun } = docx;
  const result: DocxNode[] = [];

  const inlineRuns = inlineContentToRuns(block.content, docx, ctx);
  const align = alignmentFor(block.props?.textAlignment, AlignmentType);

  switch (block.type) {
    case "heading": {
      const level = Number(block.props?.level ?? 1);
      const headingLevel = level === 1 ? HeadingLevel.HEADING_1
        : level === 2 ? HeadingLevel.HEADING_2
        : level === 3 ? HeadingLevel.HEADING_3
        : HeadingLevel.HEADING_4;
      result.push(new Paragraph({ heading: headingLevel, alignment: align, children: inlineRuns }));
      break;
    }
    case "paragraph": {
      result.push(new Paragraph({ alignment: align, children: inlineRuns }));
      break;
    }
    case "bulletListItem": {
      result.push(new Paragraph({ alignment: align, bullet: { level: listLevel }, children: inlineRuns }));
      break;
    }
    case "numberedListItem": {
      result.push(new Paragraph({ alignment: align, numbering: { reference: "default-numbering", level: listLevel }, children: inlineRuns }));
      break;
    }
    case "checkListItem": {
      const checked = Boolean(block.props?.checked);
      const prefix = new TextRun({ text: checked ? "☑ " : "☐ " });
      result.push(new Paragraph({ alignment: align, children: [prefix, ...inlineRuns] }));
      break;
    }
    case "codeBlock": {
      const text = inlineRunsToPlainText(block.content);
      const lines = text.split("\n");
      for (const line of lines) {
        result.push(new Paragraph({ style: "code", children: [new TextRun({ text: line, font: "Consolas" })] }));
      }
      break;
    }
    case "quote": {
      result.push(new Paragraph({ alignment: align, indent: { left: 720 }, children: inlineRuns }));
      break;
    }
    case "table": {
      result.push(...nativeTableToDocx(block, docx, ctx));
      break;
    }
    case "image": {
      const caption = String(block.props?.caption ?? "");
      result.push(new Paragraph({ children: [new TextRun({ text: caption || "[image]", italics: true })] }));
      break;
    }
    case "diagram": {
      result.push(...diagramToDocx(block, docx, ctx));
      break;
    }
    case "spreadsheetRange": {
      result.push(...spreadsheetRangeToDocx(block, docx, ctx));
      break;
    }
    case "documentBlockEmbed": {
      const id = String(block.props?.documentId ?? "");
      const blockId = String(block.props?.blockId ?? "");
      const resolved = id ? ctx.documentName(id) : undefined;
      const docLabel = resolved ?? (id ? shortId(id) : "document");
      const label = blockId
        ? `[Block ${shortId(blockId)} from ${docLabel}]`
        : `[Embedded block from ${docLabel}]`;
      result.push(new Paragraph({ alignment: align, children: [new TextRun({ text: label, italics: true })] }));
      break;
    }
    default: {
      if (inlineRuns.length > 0) {
        result.push(new Paragraph({ alignment: align, children: inlineRuns }));
      } else {
        const placeholder = `[${String(block.type ?? "block")}]`;
        result.push(new Paragraph({ alignment: align, children: [new TextRun({ text: placeholder, italics: true })] }));
      }
      break;
    }
  }

  if (Array.isArray(block.children) && block.children.length > 0) {
    result.push(...blocksToDocxChildren(block.children, docx, listLevel + 1, ctx));
  }
  // Suppress unused locals from destructure when this branch isn't taken
  void Table;
  void TableRow;
  void TableCell;
  void WidthType;
  void BorderStyle;
  return result;
}

function nativeTableToDocx(block: any, docx: typeof import("docx"), ctx: ExportContext): DocxNode[] {
  const { Paragraph, Table, TableRow, TableCell, WidthType, BorderStyle, TextRun } = docx;
  const rowsData: any[] = block.content?.rows ?? [];
  if (rowsData.length === 0) return [];
  const tableRows = rowsData.map((row: any) => {
    const cells: any[] = row.cells ?? [];
    return new TableRow({
      children: cells.map((cell: any) => {
        const cellInline = Array.isArray(cell) ? cell : (cell?.content ?? []);
        const cellRuns = inlineContentToRuns(cellInline, docx, ctx);
        return new TableCell({
          children: [new Paragraph({ children: cellRuns.length > 0 ? cellRuns : [new TextRun("")] })],
        });
      }),
    });
  });
  return [
    new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: simpleTableBorders(BorderStyle),
    }),
  ];
}

function spreadsheetRangeToDocx(block: any, docx: typeof import("docx"), ctx: ExportContext): DocxNode[] {
  const { Paragraph, Table, TableRow, TableCell, WidthType, BorderStyle, TextRun } = docx;
  const stableRef = String(block.props?.stableRef ?? "");
  const cells = stableRef ? ctx.spreadsheetCells(stableRef) : undefined;
  const sheetId = String(block.props?.spreadsheetId ?? "");
  const sheetName = sheetId ? ctx.spreadsheetName(sheetId) : undefined;
  const cellRef = String(block.props?.cellRef ?? "");
  const showHeaders = Boolean(block.props?.showHeaders ?? true);
  const caption = `${sheetName ?? (sheetId ? shortId(sheetId) : "spreadsheet")}${cellRef ? ` · ${cellRef}` : ""}`;

  if (!cells || cells.length === 0) {
    return [
      new Paragraph({ children: [new TextRun({ text: `[Range data unavailable: ${caption}]`, italics: true })] }),
    ];
  }

  const tableRows = cells.map((row, rowIdx) => {
    const isHeader = showHeaders && rowIdx === 0;
    return new TableRow({
      tableHeader: isHeader,
      children: row.map((value) => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: value, bold: isHeader })] })],
      })),
    });
  });

  return [
    new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: simpleTableBorders(BorderStyle),
    }),
    new Paragraph({ style: "caption", children: [new TextRun({ text: caption })] }),
  ];
}

function diagramToDocx(block: any, docx: typeof import("docx"), ctx: ExportContext): DocxNode[] {
  const { Paragraph, ImageRun, TextRun } = docx;
  const id = String(block.props?.diagramId ?? "");
  const name = id ? ctx.diagramName(id) : undefined;
  const label = name ?? (id ? shortId(id) : "diagram");
  const embed = id ? ctx.diagram(id) : undefined;

  if (!embed?.png) {
    return [new Paragraph({ children: [new TextRun({ text: `[Diagram: ${label}]`, italics: true })] })];
  }

  // Constrain max display width to ~6 inches (page width minus margins) at 96 DPI = 576px.
  const maxWidth = 576;
  const ratio = embed.png.width > 0 ? embed.png.height / embed.png.width : 1;
  const displayWidth = Math.min(embed.png.width, maxWidth);
  const displayHeight = Math.round(displayWidth * ratio);

  return [
    new Paragraph({
      alignment: docx.AlignmentType.CENTER,
      children: [
        new ImageRun({
          data: embed.png.bytes,
          transformation: { width: displayWidth, height: displayHeight },
        } as any),
      ],
    }),
    new Paragraph({ style: "caption", alignment: docx.AlignmentType.CENTER, children: [new TextRun({ text: label })] }),
  ];
}

function simpleTableBorders(BorderStyle: typeof import("docx").BorderStyle) {
  const b = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
}

function alignmentFor(textAlign: unknown, AlignmentType: typeof import("docx").AlignmentType) {
  switch (textAlign) {
    case "left": return AlignmentType.LEFT;
    case "center": return AlignmentType.CENTER;
    case "right": return AlignmentType.RIGHT;
    case "justify": return AlignmentType.JUSTIFIED;
    default: return undefined;
  }
}

function inlineContentToRuns(content: unknown, docx: typeof import("docx"), ctx: ExportContext = NULL_CONTEXT): import("docx").TextRun[] {
  const { TextRun, ExternalHyperlink } = docx;
  if (typeof content === "string") return [new TextRun({ text: content })];
  if (!Array.isArray(content)) return [];
  const runs: import("docx").TextRun[] = [];
  for (const item of content) {
    if (item == null) continue;
    if (typeof item === "string") { runs.push(new TextRun({ text: item })); continue; }
    if (item.type === "text" && typeof item.text === "string") {
      const styles = item.styles ?? {};
      runs.push(new TextRun({
        text: item.text,
        bold: !!styles.bold,
        italics: !!styles.italic,
        underline: styles.underline ? {} : undefined,
        strike: !!styles.strike,
        font: styles.code ? "Consolas" : undefined,
      }));
      continue;
    }
    if (item.type === "link" && Array.isArray(item.content)) {
      const inner = inlineContentToRuns(item.content, docx, ctx);
      runs.push(new ExternalHyperlink({ link: String(item.href ?? ""), children: inner }) as unknown as import("docx").TextRun);
      continue;
    }
    if (item.type === "mention") {
      const userId = String(item.props?.userId ?? item.props?.user ?? "");
      const resolved = userId ? ctx.userName(userId) : undefined;
      runs.push(new TextRun({ text: `@${resolved ?? (userId ? shortId(userId) : "user")}`, italics: true }));
      continue;
    }
    if (item.type === "spreadsheetLink") {
      const id = String(item.props?.spreadsheetId ?? "");
      const resolved = id ? ctx.spreadsheetName(id) : undefined;
      runs.push(new TextRun({ text: `[${resolved ?? (id ? shortId(id) : "spreadsheet")}]`, italics: true }));
      continue;
    }
    if (item.type === "spreadsheetCellRef") {
      const id = String(item.props?.spreadsheetId ?? "");
      const cellRef = String(item.props?.cellRef ?? "");
      const stableRef = String(item.props?.stableRef ?? "");
      const value = stableRef ? ctx.spreadsheetCells(stableRef)?.[0]?.[0] : undefined;
      const resolved = id ? ctx.spreadsheetName(id) : undefined;
      const sheetLabel = resolved ?? (id ? shortId(id) : "spreadsheet");
      if (value !== undefined) {
        runs.push(new TextRun({ text: value }));
        runs.push(new TextRun({ text: ` (${cellRef || "?"} @ ${sheetLabel})`, italics: true }));
      } else {
        runs.push(new TextRun({ text: `[${cellRef || "?"} @ ${sheetLabel}]`, italics: true }));
      }
      continue;
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Export context builder
// ---------------------------------------------------------------------------

interface CollectedRefs {
  diagramIds: Set<string>;
  spreadsheetIds: Set<string>;
  documentIds: Set<string>;
  userIds: Set<string>;
  /** spreadsheetRange stableRef → spreadsheetId (needed for the cell-ref query). */
  rangeRefs: Map<string, string>;
}

function collectRefs(blocks: any[], acc: CollectedRefs): void {
  for (const block of blocks) {
    if (!block) continue;
    if (block.type === "diagram" && block.props?.diagramId) {
      acc.diagramIds.add(String(block.props.diagramId));
    } else if (block.type === "spreadsheetRange") {
      const id = String(block.props?.spreadsheetId ?? "");
      const stableRef = String(block.props?.stableRef ?? "");
      if (id) acc.spreadsheetIds.add(id);
      if (id && stableRef) acc.rangeRefs.set(stableRef, id);
    } else if (block.type === "documentBlockEmbed" && block.props?.documentId) {
      acc.documentIds.add(String(block.props.documentId));
    }
    if (Array.isArray(block.content)) {
      for (const item of block.content) {
        if (!item) continue;
        if (item.type === "mention" && (item.props?.userId || item.props?.user)) {
          acc.userIds.add(String(item.props.userId ?? item.props.user));
        } else if (item.type === "spreadsheetLink" && item.props?.spreadsheetId) {
          acc.spreadsheetIds.add(String(item.props.spreadsheetId));
        } else if (item.type === "spreadsheetCellRef" && item.props?.spreadsheetId) {
          const sheetId = String(item.props.spreadsheetId);
          const stableRef = String(item.props.stableRef ?? "");
          acc.spreadsheetIds.add(sheetId);
          if (stableRef) acc.rangeRefs.set(stableRef, sheetId);
        }
      }
    }
    if (Array.isArray(block.children) && block.children.length > 0) {
      collectRefs(block.children, acc);
    }
  }
}

/** Pre-fetch every embedded resource referenced in the document so the
 *  Markdown / HTML / DOCX exporters can render real names, embedded SVGs,
 *  rasterized PNGs, and resolved cell tables. Each query failure degrades
 *  gracefully: the affected lookup returns undefined and the renderers fall
 *  back to a textual placeholder. */
export async function buildExportContext(
  convex: ConvexReactClient,
  blocks: any[],
  options: { isDark?: boolean } = {},
): Promise<ExportContext> {
  const refs: CollectedRefs = {
    diagramIds: new Set(),
    spreadsheetIds: new Set(),
    documentIds: new Set(),
    userIds: new Set(),
    rangeRefs: new Map(),
  };
  collectRefs(blocks, refs);

  const diagramNames = new Map<string, string>();
  const spreadsheetNames = new Map<string, string>();
  const documentNames = new Map<string, string>();
  const userNames = new Map<string, string>();
  const diagramEmbeds = new Map<string, DiagramEmbed>();
  const cellGrids = new Map<string, string[][]>();

  const fetchName = async <T extends { name?: string } | null>(p: Promise<T>, map: Map<string, string>, id: string) => {
    try {
      const doc = await p;
      if (doc && typeof doc.name === "string") map.set(id, doc.name);
    } catch { /* missing → fallback */ }
  };

  const fetchDiagramEmbed = async (id: string) => {
    try {
      const svg = await fetchDiagramSvgElement(convex, id as Id<"diagrams">, options.isDark ?? false);
      if (!svg) return;
      const svgHtml = svgElementToResponsiveString(svg);
      const xml = new XMLSerializer().serializeToString(svg);
      const svgBase64 = bytesToBase64(new TextEncoder().encode(xml));
      const png = await svgElementToPngBytes(svg).catch(() => null);
      diagramEmbeds.set(id, { svgHtml, svgBase64, png: png ?? undefined });
    } catch { /* embed missing → renderers fall back to text */ }
  };

  const fetchCells = async (stableRef: string, spreadsheetId: string) => {
    const cells = await fetchSpreadsheetCells(convex, spreadsheetId as Id<"spreadsheets">, stableRef);
    if (cells) cellGrids.set(stableRef, cells);
  };

  await Promise.all([
    ...Array.from(refs.diagramIds).map((id) =>
      fetchName(convex.query(api.diagrams.get, { id: id as Id<"diagrams"> }), diagramNames, id),
    ),
    ...Array.from(refs.spreadsheetIds).map((id) =>
      fetchName(convex.query(api.spreadsheets.get, { id: id as Id<"spreadsheets"> }), spreadsheetNames, id),
    ),
    ...Array.from(refs.documentIds).map((id) =>
      fetchName(convex.query(api.documents.get, { id: id as Id<"documents"> }), documentNames, id),
    ),
    ...Array.from(refs.userIds).map((id) =>
      fetchName(convex.query(api.users.get, { id: id as Id<"users"> }), userNames, id),
    ),
    ...Array.from(refs.diagramIds).map(fetchDiagramEmbed),
    ...Array.from(refs.rangeRefs.entries()).map(([stableRef, sheetId]) => fetchCells(stableRef, sheetId)),
  ]);

  return {
    diagramName: (id) => diagramNames.get(id),
    spreadsheetName: (id) => spreadsheetNames.get(id),
    documentName: (id) => documentNames.get(id),
    userName: (id) => userNames.get(id),
    diagram: (id) => diagramEmbeds.get(id),
    spreadsheetCells: (stableRef) => cellGrids.get(stableRef),
  };
}
