import { isBlocksEmpty } from "@/lib/editor-utils";
import { BlockNoteRenderer } from "@/components/BlockNoteRenderer";
import { splitCommentBody } from "./commentAttachments";
import { CommentAttachmentList } from "./CommentAttachments";

/**
 * Lightweight read-only renderer for BlockNote comment JSON.
 * Thin wrapper around BlockNoteRenderer that parses the JSON string
 * and applies comment-appropriate sizing. Attachments (trailing `file`
 * blocks, see `commentAttachments`) render as download cards under the text.
 */
export function StaticCommentBody({ body }: { body: string }) {
  const { blocks, attachments } = splitCommentBody(body);
  return (
    <div className="text-sm">
      {/* An attachment-only comment has just an empty paragraph — no blank line for it. */}
      {(!isBlocksEmpty(blocks) || attachments.length === 0) && <BlockNoteRenderer blocks={blocks} />}
      <CommentAttachmentList attachments={attachments} />
    </div>
  );
}
