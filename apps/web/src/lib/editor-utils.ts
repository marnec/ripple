import type { BlockNoteEditor } from "@blocknote/core";
import { tableCellContent } from "./blocknote-table";

/** Check if a BlockNote editor is empty (no text, no inline nodes like mentions). */
export function isEditorEmpty(editor: BlockNoteEditor<any, any, any>): boolean {
  const doc = editor._tiptapEditor.state.doc;
  if (doc.textContent.trim().length > 0) return false;
  let hasInlineContent = false;
  doc.descendants((node) => {
    if (hasInlineContent) return false;
    if (node.isInline && !node.isText) {
      hasInlineContent = true;
      return false;
    }
  });
  return !hasInlineContent;
}

/** Check if a BlockNote document (block array) is empty — for cases where you have blocks but not the editor instance. */
export function isBlocksEmpty(blocks: unknown[]): boolean {
  if (blocks.length === 0) return true;
  if (blocks.length === 1) {
    const block = blocks[0] as { type: string; content?: unknown };
    if (
      block.type === "paragraph" &&
      (!block.content ||
        (Array.isArray(block.content) && block.content.length === 0))
    ) {
      return true;
    }
  }
  return false;
}

/** Clear all blocks from a BlockNote editor. */
export function editorClear(editor: BlockNoteEditor<any, any, any>): void {
  editor.removeBlocks(editor.document.map((b) => b.id));
}

/** Parse comment body JSON, with backwards-compatible plain text fallback.
 *
 * The fallback wraps the raw string as a single text inline node — not as a
 * bare string on `content`. BlockNoteRenderer only renders `content` when it's
 * an array of inline nodes, so a bare string renders as nothing. This path is
 * hit by legacy plain-text comments and by GitHub-synced comments, whose body
 * is plain markdown text rather than BlockNote JSON. */
export function parseCommentBody(body: string): any[] {
  try {
    return JSON.parse(body);
  } catch {
    return [
      {
        id: crypto.randomUUID(),
        type: "paragraph",
        content: [{ type: "text", text: body, styles: {} }],
      },
    ];
  }
}

/** A `tableContent` row's cells, flattened to their text. */
function tableRowToText(row: { cells: unknown[] }): string {
  return row.cells
    .map((cell) =>
      tableCellContent(cell)
        .map((node: any) => (node?.type === "text" ? node.text : ""))
        .join(""),
    )
    .join(" | ");
}

/** Extract plain text from BlockNote document JSON, including mention text.
 *
 * This is the SEARCH projection, and it deliberately says more than the
 * server's `extractPlainTextFromBody` does: it flattens table cells, so a
 * frozen spreadsheet range posted to a channel can be found by the numbers in
 * it. The server's copy feeds reply previews and lock screens, where a wall of
 * pipe-separated cells is noise — it stops at the chip. Keep the two apart on
 * purpose; everything else about them agrees.
 */
export function blocksToPlainText(
  blocks: any[],
  userNames: Map<string, string>,
  projectNames: Map<string, string>,
): string {
  const lines: string[] = [];
  for (const block of blocks) {
    let line = "";
    if (Array.isArray(block.content)) {
      for (const inline of block.content) {
        switch (inline.type) {
          case "text":
            line += inline.text;
            break;
          case "link":
            for (const c of inline.content || []) line += c.text;
            break;
          case "taskMention":
            line += `#${inline.props.taskTitle || "task"}`;
            break;
          case "userMention": {
            const name = userNames.get(inline.props.userId);
            line += `@${name || "user"}`;
            break;
          }
          case "projectReference": {
            const name = projectNames.get(inline.props.projectId);
            line += `#${name || "project"}`;
            break;
          }
          case "resourceReference":
            line += `#${inline.props.resourceName || "resource"}`;
            if (inline.props.cellRef) line += ` \u203A ${inline.props.cellRef}`;
            break;
        }
      }
    }
    if (
      block.content &&
      !Array.isArray(block.content) &&
      block.content.type === "tableContent"
    ) {
      line = block.content.rows.map(tableRowToText).join("\n");
    }
    lines.push(line);
    if (block.children?.length) {
      lines.push(blocksToPlainText(block.children, userNames, projectNames));
    }
  }
  return lines.join("\n").trim();
}
