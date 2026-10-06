import { parseCommentBody } from "@/lib/editor-utils";
import type { FileAttachment } from "../Chat/FileAttachmentCard";

/**
 * A comment's attachments live in its stored body as trailing `file` blocks,
 * the shape chat messages already use — so the server's upload tracking
 * (`mediaRefs`) reads them like any other embedded URL. They are never
 * authored inside the editor: the comment schema has no media blocks, so the
 * composer holds them beside the editor and they are split off before a body
 * is loaded into one, and joined back on save.
 */

type Block = { type?: string; props?: Record<string, unknown> };

/** Split a stored comment body into its editable blocks and its attachments. */
export function splitCommentBody(body: string): {
  blocks: any[];
  attachments: FileAttachment[];
} {
  const all: Block[] = parseCommentBody(body);
  const blocks: Block[] = [];
  const attachments: FileAttachment[] = [];
  for (const block of all) {
    if (block.type !== "file") {
      blocks.push(block);
      continue;
    }
    const props = block.props ?? {};
    if (typeof props.url !== "string" || !props.url) continue;
    attachments.push({
      url: props.url,
      name: typeof props.name === "string" && props.name ? props.name : "attachment",
      mimeType: typeof props.mimeType === "string" ? props.mimeType : undefined,
      size: typeof props.size === "number" ? props.size : undefined,
    });
  }
  return { blocks, attachments };
}

/** The stored body for `blocks` (the editor's document) plus `attachments`. */
export function joinCommentBody(blocks: unknown[], attachments: readonly FileAttachment[]): string {
  return JSON.stringify([
    ...blocks,
    ...attachments.map((a) => ({
      type: "file",
      props: { url: a.url, name: a.name, mimeType: a.mimeType, size: a.size },
    })),
  ]);
}
