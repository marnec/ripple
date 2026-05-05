// Document exporter (Markdown, HTML, DOCX).
//
// Three format-specific block walkers consume the typed `ExportBlock[]` AST
// produced by `parse.ts`. Inline content rendering goes through a single
// `walkInline()` over an `InlineRenderer<T>` adapter so the per-format inline
// switch lives in just one place.

import type { BlockNoteEditor } from "@blocknote/core";
import type { ConvexReactClient } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sanitizeFilename, triggerDownload } from "@/lib/download-blob";
import { fetchCellGrid, resolveDiagramEmbed } from "./embeds";
import { parseBlocks } from "./parse";
import type {
  DiagramEmbed,
  ExportBlock,
  ExportContext,
  ExportInline,
  IncomingBlock,
  InlineStyles,
  TextAlign,
} from "./types";
import { NULL_EXPORT_CONTEXT } from "./types";

type AnyEditor = BlockNoteEditor<any, any, any>;

function getEditorBlocks(editor: AnyEditor): IncomingBlock[] {
  return editor.document;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId(id: string): string {
  return id.length > 8 ? id.slice(-6) : id;
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

function diagramLabel(id: string, ctx: ExportContext): string {
  return ctx.diagramName(id) ?? (id ? shortId(id) : "diagram");
}

function spreadsheetLabel(id: string, ctx: ExportContext): string {
  return ctx.spreadsheetName(id) ?? (id ? shortId(id) : "spreadsheet");
}

function documentLabel(id: string, ctx: ExportContext): string {
  return ctx.documentName(id) ?? (id ? shortId(id) : "document");
}

// ---------------------------------------------------------------------------
// Shared inline walker
// ---------------------------------------------------------------------------

interface InlineRenderer<T> {
  text(text: string, styles: InlineStyles): T;
  link(href: string, children: T[]): T;
  mention(name: string): T;
  sheetLink(name: string): T;
  /** value: cell value (undefined if unresolved); cellRef: like "A1"; sheetName: resolved name. */
  sheetCellRef(value: string | undefined, cellRef: string, sheetName: string): T;
}

function walkInline<T>(items: ExportInline[], ctx: ExportContext, r: InlineRenderer<T>): T[] {
  const out: T[] = [];
  for (const item of items) {
    switch (item.kind) {
      case "text":
        out.push(r.text(item.text, item.styles));
        break;
      case "link":
        out.push(r.link(item.href, walkInline(item.children, ctx, r)));
        break;
      case "mention": {
        const name = ctx.userName(item.userId) ?? (item.userId ? shortId(item.userId) : "user");
        out.push(r.mention(name));
        break;
      }
      case "sheetLink":
        out.push(r.sheetLink(spreadsheetLabel(item.spreadsheetId, ctx)));
        break;
      case "sheetCellRef": {
        const value = item.stableRef ? ctx.cells(item.stableRef)?.[0]?.[0] : undefined;
        out.push(r.sheetCellRef(value, item.cellRef || "?", spreadsheetLabel(item.spreadsheetId, ctx)));
        break;
      }
    }
  }
  return out;
}

// ===========================================================================
// Markdown
// ===========================================================================

const mdInline: InlineRenderer<string> = {
  text(text, styles) {
    let s = escapeMd(text);
    if (styles.code) s = `\`${text}\``;
    if (styles.bold) s = `**${s}**`;
    if (styles.italic) s = `*${s}*`;
    if (styles.strike) s = `~~${s}~~`;
    return s;
  },
  link(href, children) {
    return `[${children.join("")}](${href})`;
  },
  mention(name) {
    return `@${escapeMd(name)}`;
  },
  sheetLink(name) {
    return `\`${name}\``;
  },
  sheetCellRef(value, cellRef, sheetName) {
    return value !== undefined
      ? `${escapeMd(value)} _(${escapeMd(cellRef)} @ ${escapeMd(sheetName)})_`
      : `\`${cellRef}\` _(${escapeMd(sheetName)})_`;
  },
};

const mdEscapeCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function exportDocumentMarkdown(
  editor: AnyEditor,
  name: string,
  ctx: ExportContext = NULL_EXPORT_CONTEXT,
): void {
  const blocks = parseBlocks(getEditorBlocks(editor));
  const md = blocksToMarkdown(blocks, ctx, 0);
  triggerDownload(
    new Blob([md], { type: "text/markdown;charset=utf-8" }),
    `${sanitizeFilename(name)}.md`,
  );
}

function blocksToMarkdown(blocks: ExportBlock[], ctx: ExportContext, listLevel: number): string {
  let out = "";
  let numberedIndex = 1;
  let prevKind: ExportBlock["kind"] | null = null;
  for (const block of blocks) {
    if (block.kind === "numberedItem" && prevKind !== "numberedItem") numberedIndex = 1;
    out += blockToMarkdown(block, ctx, listLevel, numberedIndex);
    if (block.kind === "numberedItem") numberedIndex++;
    prevKind = block.kind;
  }
  return out;
}

function blockToMarkdown(
  block: ExportBlock,
  ctx: ExportContext,
  listLevel: number,
  numberedIndex: number,
): string {
  const indent = "  ".repeat(listLevel);
  const inline = (items: ExportInline[]) => walkInline(items, ctx, mdInline).join("");
  let out = "";

  switch (block.kind) {
    case "heading":
      out = `${"#".repeat(block.level)} ${inline(block.content)}\n\n`;
      break;
    case "paragraph":
      out = `${inline(block.content)}\n\n`;
      break;
    case "bulletItem":
      out = `${indent}- ${inline(block.content)}\n`;
      break;
    case "numberedItem":
      out = `${indent}${numberedIndex}. ${inline(block.content)}\n`;
      break;
    case "checkItem":
      out = `${indent}- [${block.checked ? "x" : " "}] ${inline(block.content)}\n`;
      break;
    case "codeBlock":
      out = `\`\`\`${block.language}\n${block.text}\n\`\`\`\n\n`;
      break;
    case "quote":
      out = `> ${inline(block.content)}\n\n`;
      break;
    case "table":
      out = nativeTableToMarkdown(block.rows, ctx) + "\n";
      break;
    case "image":
      out = block.url ? `![${escapeMd(block.caption)}](${block.url})\n\n` : "";
      break;
    case "spreadsheetRange":
      out = spreadsheetRangeToMarkdown(block, ctx) + "\n";
      break;
    case "diagram":
      out = diagramToMarkdown(block.diagramId, ctx) + "\n";
      break;
    case "documentBlockEmbed":
      out = `> _Embedded block from ${escapeMd(documentLabel(block.documentId, ctx))}_\n\n`;
      break;
    case "unknown": {
      const text = inline(block.content);
      if (text.trim()) out = `${text}\n\n`;
      break;
    }
  }
  if ("children" in block && block.children.length > 0) {
    out += blocksToMarkdown(block.children, ctx, listLevel + 1);
  }
  return out;
}

function nativeTableToMarkdown(rows: ExportInline[][][], ctx: ExportContext): string {
  if (rows.length === 0) return "";
  const cellText = (cell: ExportInline[]) => mdEscapeCell(walkInline(cell, ctx, mdInline).join(""));
  const lines: string[] = [];
  rows.forEach((row, i) => {
    lines.push(`| ${row.map(cellText).join(" | ")} |`);
    if (i === 0) lines.push(`| ${row.map(() => "---").join(" | ")} |`);
  });
  return lines.join("\n") + "\n";
}

function spreadsheetRangeToMarkdown(
  block: Extract<ExportBlock, { kind: "spreadsheetRange" }>,
  ctx: ExportContext,
): string {
  const cells = block.stableRef ? ctx.cells(block.stableRef) : undefined;
  const sheetName = spreadsheetLabel(block.spreadsheetId, ctx);
  const captionText = block.cellRef ? `${sheetName} · ${block.cellRef}` : sheetName;
  const caption = `_${escapeMd(captionText)}_`;
  if (!cells || cells.length === 0) return `${caption}\n\n_Range data unavailable_\n`;

  const lines: string[] = [];
  if (block.showHeaders) {
    const header = cells[0];
    if (!header) return `${caption}\n\n_Range data unavailable_\n`;
    lines.push(`| ${header.map(mdEscapeCell).join(" | ")} |`);
    lines.push(`| ${header.map(() => "---").join(" | ")} |`);
    for (let i = 1; i < cells.length; i++) {
      const row = cells[i];
      if (row) lines.push(`| ${row.map(mdEscapeCell).join(" | ")} |`);
    }
  } else {
    const cols = cells[0]?.length ?? 0;
    lines.push(`| ${Array.from({ length: cols }, (_, i) => `Col ${i + 1}`).join(" | ")} |`);
    lines.push(`| ${Array.from({ length: cols }, () => "---").join(" | ")} |`);
    for (const row of cells) lines.push(`| ${row.map(mdEscapeCell).join(" | ")} |`);
  }
  return `${caption}\n\n${lines.join("\n")}\n`;
}

function diagramToMarkdown(diagramId: string, ctx: ExportContext): string {
  const label = diagramLabel(diagramId, ctx);
  const embed = diagramId ? ctx.diagram(diagramId) : undefined;
  return embed
    ? `![${escapeMd(label)}](data:image/svg+xml;base64,${embed.svgBase64})\n`
    : `_[Diagram: ${escapeMd(label)}]_\n`;
}

// ===========================================================================
// HTML
// ===========================================================================

const htmlInline: InlineRenderer<string> = {
  text(text, styles) {
    let html = escapeHtml(text);
    if (styles.code) html = `<code>${html}</code>`;
    if (styles.bold) html = `<strong>${html}</strong>`;
    if (styles.italic) html = `<em>${html}</em>`;
    if (styles.underline) html = `<u>${html}</u>`;
    if (styles.strike) html = `<s>${html}</s>`;
    return html;
  },
  link(href, children) {
    return `<a href="${escapeHtml(href)}">${children.join("")}</a>`;
  },
  mention(name) {
    return `<em>@${escapeHtml(name)}</em>`;
  },
  sheetLink(name) {
    return `<code>${escapeHtml(name)}</code>`;
  },
  sheetCellRef(value, cellRef, sheetName) {
    return value !== undefined
      ? `${escapeHtml(value)} <em>(${escapeHtml(cellRef)} @ ${escapeHtml(sheetName)})</em>`
      : `<code>${escapeHtml(cellRef)}</code> <em>(${escapeHtml(sheetName)})</em>`;
  },
};

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

export function exportDocumentHTML(
  editor: AnyEditor,
  name: string,
  ctx: ExportContext = NULL_EXPORT_CONTEXT,
): void {
  const blocks = parseBlocks(getEditorBlocks(editor));
  const body = blocksToHtml(blocks, ctx);
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
  triggerDownload(
    new Blob([html], { type: "text/html;charset=utf-8" }),
    `${sanitizeFilename(name)}.html`,
  );
}

function blocksToHtml(blocks: ExportBlock[], ctx: ExportContext): string {
  // Group consecutive list items so we can wrap them in <ul>/<ol>.
  let html = "";
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (!block) { i++; continue; }
    if (block.kind === "bulletItem" || block.kind === "numberedItem") {
      const tag = block.kind === "bulletItem" ? "ul" : "ol";
      const startKind = block.kind;
      let items = "";
      while (i < blocks.length) {
        const next = blocks[i];
        if (!next || (next.kind !== "bulletItem" && next.kind !== "numberedItem")) break;
        if (next.kind !== startKind) break;
        const inner = walkInline(next.content, ctx, htmlInline).join("");
        const childHtml = next.children.length > 0 ? blocksToHtml(next.children, ctx) : "";
        items += `<li>${inner}${childHtml}</li>`;
        i++;
      }
      html += `<${tag}>${items}</${tag}>`;
    } else if (block.kind === "checkItem") {
      let items = "";
      while (i < blocks.length) {
        const next = blocks[i];
        if (!next || next.kind !== "checkItem") break;
        const inner = walkInline(next.content, ctx, htmlInline).join("");
        const childHtml = next.children.length > 0 ? blocksToHtml(next.children, ctx) : "";
        const checked = next.checked ? " checked" : "";
        items += `<li><input type="checkbox" disabled${checked}> ${inner}${childHtml}</li>`;
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

function blockToHtml(block: ExportBlock, ctx: ExportContext): string {
  let out = "";
  switch (block.kind) {
    case "heading": {
      const styleAttr = alignAttr(block.align);
      out = `<h${block.level}${styleAttr}>${walkInline(block.content, ctx, htmlInline).join("")}</h${block.level}>`;
      break;
    }
    case "paragraph": {
      out = `<p${alignAttr(block.align)}>${walkInline(block.content, ctx, htmlInline).join("")}</p>`;
      break;
    }
    case "codeBlock": {
      const langAttr = block.language ? ` class="language-${escapeHtml(block.language)}"` : "";
      out = `<pre><code${langAttr}>${escapeHtml(block.text)}</code></pre>`;
      break;
    }
    case "quote": {
      out = `<blockquote${alignAttr(block.align)}>${walkInline(block.content, ctx, htmlInline).join("")}</blockquote>`;
      break;
    }
    case "table":
      out = nativeTableToHtml(block.rows, ctx);
      break;
    case "image": {
      if (!block.url) break;
      const alt = escapeHtml(block.caption);
      out = `<figure class="embed"><img src="${escapeHtml(block.url)}" alt="${alt}">${block.caption ? `<figcaption class="embed-caption">${alt}</figcaption>` : ""}</figure>`;
      break;
    }
    case "spreadsheetRange":
      out = spreadsheetRangeToHtml(block, ctx);
      break;
    case "diagram":
      out = diagramToHtml(block.diagramId, ctx);
      break;
    case "documentBlockEmbed":
      out = `<blockquote class="embed"><em>Embedded block from ${escapeHtml(documentLabel(block.documentId, ctx))}</em></blockquote>`;
      break;
    case "unknown": {
      const inner = walkInline(block.content, ctx, htmlInline).join("");
      if (inner.trim()) out = `<p>${inner}</p>`;
      break;
    }
    // List items are normally consumed by `blocksToHtml`'s grouping pass; we
    // fall through here only when a list item appears in an unexpected
    // position, in which case we emit an unwrapped <li> for safety.
    case "bulletItem":
    case "numberedItem":
    case "checkItem": {
      const inner = walkInline(block.content, ctx, htmlInline).join("");
      const childHtml = block.children.length > 0 ? blocksToHtml(block.children, ctx) : "";
      out = `<li>${inner}${childHtml}</li>`;
      break;
    }
  }
  if ("children" in block && block.children.length > 0
    && block.kind !== "bulletItem" && block.kind !== "numberedItem" && block.kind !== "checkItem"
  ) {
    out += blocksToHtml(block.children, ctx);
  }
  return out;
}

function alignAttr(align: TextAlign | undefined): string {
  return align && align !== "left" ? ` style="text-align:${align}"` : "";
}

function nativeTableToHtml(rows: ExportInline[][][], ctx: ExportContext): string {
  if (rows.length === 0) return "";
  const tr = rows.map((row) =>
    `<tr>${row.map((cell) => `<td>${walkInline(cell, ctx, htmlInline).join("")}</td>`).join("")}</tr>`,
  ).join("");
  return `<table>${tr}</table>`;
}

function spreadsheetRangeToHtml(
  block: Extract<ExportBlock, { kind: "spreadsheetRange" }>,
  ctx: ExportContext,
): string {
  const cells = block.stableRef ? ctx.cells(block.stableRef) : undefined;
  const sheetName = spreadsheetLabel(block.spreadsheetId, ctx);
  const caption = `${escapeHtml(sheetName)}${block.cellRef ? ` · ${escapeHtml(block.cellRef)}` : ""}`;
  if (!cells || cells.length === 0) {
    return `<figure class="embed"><table><tbody><tr><td><em>Range data unavailable</em></td></tr></tbody></table><figcaption class="embed-caption">${caption}</figcaption></figure>`;
  }
  let head = "";
  let bodyRows: string[][] = cells;
  const headerRow = cells[0];
  if (block.showHeaders && headerRow) {
    head = `<thead><tr>${headerRow.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
    bodyRows = cells.slice(1);
  }
  const tbody = `<tbody>${bodyRows.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<figure class="embed"><table>${head}${tbody}</table><figcaption class="embed-caption">${caption}</figcaption></figure>`;
}

function diagramToHtml(diagramId: string, ctx: ExportContext): string {
  const label = diagramLabel(diagramId, ctx);
  const embed = diagramId ? ctx.diagram(diagramId) : undefined;
  return embed
    ? `<figure class="embed">${embed.svgHtml}<figcaption class="embed-caption">${escapeHtml(label)}</figcaption></figure>`
    : `<figure class="embed"><em>[Diagram: ${escapeHtml(label)}]</em></figure>`;
}

// ===========================================================================
// DOCX
// ===========================================================================

type DocxModule = typeof import("docx");
type DocxNode = import("docx").Paragraph | import("docx").Table;
type DocxRun = import("docx").ParagraphChild;

function makeDocxInline(docx: DocxModule): InlineRenderer<DocxRun> {
  const { TextRun, ExternalHyperlink } = docx;
  return {
    text(text, styles) {
      return new TextRun({
        text,
        bold: styles.bold,
        italics: styles.italic,
        underline: styles.underline ? {} : undefined,
        strike: styles.strike,
        font: styles.code ? "Consolas" : undefined,
      });
    },
    link(href, children) {
      return new ExternalHyperlink({ link: href, children });
    },
    mention(name) {
      return new TextRun({ text: `@${name}`, italics: true });
    },
    sheetLink(name) {
      return new TextRun({ text: `[${name}]`, italics: true });
    },
    sheetCellRef(value, cellRef, sheetName) {
      if (value !== undefined) {
        return new TextRun({ text: `${value} (${cellRef} @ ${sheetName})` });
      }
      return new TextRun({ text: `[${cellRef} @ ${sheetName}]`, italics: true });
    },
  };
}

export async function exportDocumentDocx(
  editor: AnyEditor,
  name: string,
  ctx: ExportContext = NULL_EXPORT_CONTEXT,
): Promise<void> {
  const docx = await import("docx");
  const blocks = parseBlocks(getEditorBlocks(editor));
  const inline = makeDocxInline(docx);
  const children = blocksToDocx(blocks, docx, inline, ctx, 0);

  const doc = new docx.Document({
    sections: [{ properties: {}, children }],
    styles: {
      paragraphStyles: [
        { id: "code", name: "Code", run: { font: "Consolas", size: 20 } },
        { id: "caption", name: "Caption", run: { italics: true, size: 18, color: "666666" } },
      ],
    },
    numbering: {
      config: [{
        reference: "default-numbering",
        levels: [
          { level: 0, format: docx.LevelFormat.DECIMAL, text: "%1.", alignment: docx.AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: docx.LevelFormat.LOWER_LETTER, text: "%2.", alignment: docx.AlignmentType.START, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
          { level: 2, format: docx.LevelFormat.LOWER_ROMAN, text: "%3.", alignment: docx.AlignmentType.START, style: { paragraph: { indent: { left: 2160, hanging: 360 } } } },
        ],
      }],
    },
  });

  const blob = await docx.Packer.toBlob(doc);
  triggerDownload(blob, `${sanitizeFilename(name)}.docx`);
}

function blocksToDocx(
  blocks: ExportBlock[],
  docx: DocxModule,
  inline: InlineRenderer<DocxRun>,
  ctx: ExportContext,
  listLevel: number,
): DocxNode[] {
  const out: DocxNode[] = [];
  for (const block of blocks) {
    out.push(...blockToDocx(block, docx, inline, ctx, listLevel));
  }
  return out;
}

function blockToDocx(
  block: ExportBlock,
  docx: DocxModule,
  inline: InlineRenderer<DocxRun>,
  ctx: ExportContext,
  listLevel: number,
): DocxNode[] {
  const align = docxAlign(docx, "align" in block ? block.align : undefined);
  const inlineRuns = (items: ExportInline[]) => walkInline(items, ctx, inline);
  const result: DocxNode[] = [];

  switch (block.kind) {
    case "heading":
      result.push(new docx.Paragraph({
        heading: docxHeadingLevel(docx, block.level),
        alignment: align,
        children: inlineRuns(block.content),
      }));
      break;
    case "paragraph":
      result.push(new docx.Paragraph({ alignment: align, children: inlineRuns(block.content) }));
      break;
    case "bulletItem":
      result.push(new docx.Paragraph({
        alignment: align,
        bullet: { level: listLevel },
        children: inlineRuns(block.content),
      }));
      break;
    case "numberedItem":
      result.push(new docx.Paragraph({
        alignment: align,
        numbering: { reference: "default-numbering", level: listLevel },
        children: inlineRuns(block.content),
      }));
      break;
    case "checkItem": {
      const prefix = new docx.TextRun({ text: block.checked ? "☑ " : "☐ " });
      result.push(new docx.Paragraph({
        alignment: align,
        children: [prefix, ...inlineRuns(block.content)],
      }));
      break;
    }
    case "codeBlock": {
      const lines = block.text.split("\n");
      for (const line of lines) {
        result.push(new docx.Paragraph({
          style: "code",
          children: [new docx.TextRun({ text: line, font: "Consolas" })],
        }));
      }
      break;
    }
    case "quote":
      result.push(new docx.Paragraph({
        alignment: align,
        indent: { left: 720 },
        children: inlineRuns(block.content),
      }));
      break;
    case "table":
      result.push(...nativeTableToDocx(block.rows, docx, inline, ctx));
      break;
    case "image": {
      const text = block.caption || "[image]";
      result.push(new docx.Paragraph({ children: [new docx.TextRun({ text, italics: true })] }));
      break;
    }
    case "diagram":
      result.push(...diagramToDocx(block.diagramId, docx, ctx, align));
      break;
    case "spreadsheetRange":
      result.push(...spreadsheetRangeToDocx(block, docx, ctx));
      break;
    case "documentBlockEmbed": {
      const docLabel = documentLabel(block.documentId, ctx);
      const text = block.blockId
        ? `[Block ${shortId(block.blockId)} from ${docLabel}]`
        : `[Embedded block from ${docLabel}]`;
      result.push(new docx.Paragraph({
        alignment: align,
        children: [new docx.TextRun({ text, italics: true })],
      }));
      break;
    }
    case "unknown": {
      const runs = inlineRuns(block.content);
      const text = runs.length > 0 ? undefined : `[${block.type}]`;
      result.push(text === undefined
        ? new docx.Paragraph({ alignment: align, children: runs })
        : new docx.Paragraph({ alignment: align, children: [new docx.TextRun({ text, italics: true })] }));
      break;
    }
  }

  if ("children" in block && block.children.length > 0) {
    result.push(...blocksToDocx(block.children, docx, inline, ctx, listLevel + 1));
  }
  return result;
}

function nativeTableToDocx(
  rows: ExportInline[][][],
  docx: DocxModule,
  inline: InlineRenderer<DocxRun>,
  ctx: ExportContext,
): DocxNode[] {
  if (rows.length === 0) return [];
  const tableRows = rows.map((row) =>
    new docx.TableRow({
      children: row.map((cell) => {
        const runs = walkInline(cell, ctx, inline);
        return new docx.TableCell({
          children: [new docx.Paragraph({
            children: runs.length > 0 ? runs : [new docx.TextRun("")],
          })],
        });
      }),
    }),
  );
  return [new docx.Table({
    rows: tableRows,
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    borders: tableBorders(docx),
  })];
}

function spreadsheetRangeToDocx(
  block: Extract<ExportBlock, { kind: "spreadsheetRange" }>,
  docx: DocxModule,
  ctx: ExportContext,
): DocxNode[] {
  const cells = block.stableRef ? ctx.cells(block.stableRef) : undefined;
  const sheetName = spreadsheetLabel(block.spreadsheetId, ctx);
  const caption = block.cellRef ? `${sheetName} · ${block.cellRef}` : sheetName;

  if (!cells || cells.length === 0) {
    return [new docx.Paragraph({
      children: [new docx.TextRun({ text: `[Range data unavailable: ${caption}]`, italics: true })],
    })];
  }

  const tableRows = cells.map((row, rowIdx) => {
    const isHeader = block.showHeaders && rowIdx === 0;
    return new docx.TableRow({
      tableHeader: isHeader,
      children: row.map((value) => new docx.TableCell({
        children: [new docx.Paragraph({
          children: [new docx.TextRun({ text: value, bold: isHeader })],
        })],
      })),
    });
  });

  return [
    new docx.Table({
      rows: tableRows,
      width: { size: 100, type: docx.WidthType.PERCENTAGE },
      borders: tableBorders(docx),
    }),
    new docx.Paragraph({
      style: "caption",
      children: [new docx.TextRun({ text: caption })],
    }),
  ];
}

function diagramToDocx(
  diagramId: string,
  docx: DocxModule,
  ctx: ExportContext,
  align: ReturnType<typeof docxAlign>,
): DocxNode[] {
  const label = diagramLabel(diagramId, ctx);
  const embed: DiagramEmbed | undefined = diagramId ? ctx.diagram(diagramId) : undefined;

  if (!embed?.png) {
    return [new docx.Paragraph({
      alignment: align,
      children: [new docx.TextRun({ text: `[Diagram: ${label}]`, italics: true })],
    })];
  }

  // Constrain max display width to ~6 inches (page width minus margins) at 96 DPI.
  const MAX_DISPLAY_PX = 576;
  const ratio = embed.png.width > 0 ? embed.png.height / embed.png.width : 1;
  const displayWidth = Math.min(embed.png.width, MAX_DISPLAY_PX);
  const displayHeight = Math.round(displayWidth * ratio);

  return [
    new docx.Paragraph({
      alignment: docx.AlignmentType.CENTER,
      children: [
        new docx.ImageRun({
          type: "png",
          data: embed.png.bytes,
          transformation: { width: displayWidth, height: displayHeight },
        }),
      ],
    }),
    new docx.Paragraph({
      style: "caption",
      alignment: docx.AlignmentType.CENTER,
      children: [new docx.TextRun({ text: label })],
    }),
  ];
}

function tableBorders(docx: DocxModule) {
  const b = { style: docx.BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
}

function docxAlign(docx: DocxModule, align: import("./types").TextAlign | undefined) {
  switch (align) {
    case "left": return docx.AlignmentType.LEFT;
    case "center": return docx.AlignmentType.CENTER;
    case "right": return docx.AlignmentType.RIGHT;
    case "justify": return docx.AlignmentType.JUSTIFIED;
    default: return undefined;
  }
}

function docxHeadingLevel(docx: DocxModule, level: 1 | 2 | 3 | 4 | 5 | 6) {
  switch (level) {
    case 1: return docx.HeadingLevel.HEADING_1;
    case 2: return docx.HeadingLevel.HEADING_2;
    case 3: return docx.HeadingLevel.HEADING_3;
    case 4: return docx.HeadingLevel.HEADING_4;
    case 5: return docx.HeadingLevel.HEADING_5;
    case 6: return docx.HeadingLevel.HEADING_6;
  }
}

// ===========================================================================
// Export context builder
// ===========================================================================

interface CollectedRefs {
  diagramIds: Set<string>;
  spreadsheetIds: Set<string>;
  documentIds: Set<string>;
  userIds: Set<string>;
  /** stableRef → spreadsheetId — covers both spreadsheetRange blocks and inline cellRefs. */
  rangeRefs: Map<string, string>;
}

function collectRefs(blocks: ExportBlock[], acc: CollectedRefs): void {
  for (const block of blocks) {
    switch (block.kind) {
      case "diagram":
        if (block.diagramId) acc.diagramIds.add(block.diagramId);
        break;
      case "spreadsheetRange":
        if (block.spreadsheetId) acc.spreadsheetIds.add(block.spreadsheetId);
        if (block.spreadsheetId && block.stableRef) {
          acc.rangeRefs.set(block.stableRef, block.spreadsheetId);
        }
        break;
      case "documentBlockEmbed":
        if (block.documentId) acc.documentIds.add(block.documentId);
        break;
    }
    if ("content" in block) collectInlineRefs(block.content, acc);
    if ("children" in block && block.children.length > 0) collectRefs(block.children, acc);
  }
}

function collectInlineRefs(items: ExportInline[], acc: CollectedRefs): void {
  for (const item of items) {
    switch (item.kind) {
      case "link":
        collectInlineRefs(item.children, acc);
        break;
      case "mention":
        if (item.userId) acc.userIds.add(item.userId);
        break;
      case "sheetLink":
        if (item.spreadsheetId) acc.spreadsheetIds.add(item.spreadsheetId);
        break;
      case "sheetCellRef":
        if (item.spreadsheetId) acc.spreadsheetIds.add(item.spreadsheetId);
        if (item.spreadsheetId && item.stableRef) {
          acc.rangeRefs.set(item.stableRef, item.spreadsheetId);
        }
        break;
    }
  }
}

interface BuildContextOptions {
  isDark?: boolean;
}

/** Pre-fetch every embedded resource referenced in the document. Failed
 *  fetches degrade gracefully — the affected lookup returns undefined and
 *  the renderers fall back to a textual placeholder. */
export async function buildExportContext(
  convex: ConvexReactClient,
  editor: AnyEditor,
  options: BuildContextOptions = {},
): Promise<ExportContext> {
  const blocks = parseBlocks(getEditorBlocks(editor));
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

  const fetchName = async <T extends { name?: string } | null>(
    p: Promise<T>,
    map: Map<string, string>,
    id: string,
  ) => {
    try {
      const doc = await p;
      if (doc && typeof doc.name === "string") map.set(id, doc.name);
    } catch { /* fallback to shortId */ }
  };

  const fetchDiagram = async (id: string) => {
    const embed = await resolveDiagramEmbed(convex, id as Id<"diagrams">, {
      isDark: options.isDark ?? false,
    });
    if (embed) diagramEmbeds.set(id, embed);
  };

  const fetchCells = async (stableRef: string, spreadsheetId: string) => {
    const cells = await fetchCellGrid(convex, spreadsheetId as Id<"spreadsheets">, stableRef);
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
    ...Array.from(refs.diagramIds).map(fetchDiagram),
    ...Array.from(refs.rangeRefs.entries()).map(([stableRef, sheetId]) => fetchCells(stableRef, sheetId)),
  ]);

  return {
    diagramName: (id) => diagramNames.get(id),
    spreadsheetName: (id) => spreadsheetNames.get(id),
    documentName: (id) => documentNames.get(id),
    userName: (id) => userNames.get(id),
    diagram: (id) => diagramEmbeds.get(id),
    cells: (stableRef) => cellGrids.get(stableRef),
  };
}
