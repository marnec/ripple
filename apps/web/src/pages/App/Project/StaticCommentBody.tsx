import { parseCommentBody } from "@/lib/editor-utils";
import { BlockNoteRenderer } from "@/components/BlockNoteRenderer";

/**
 * Lightweight read-only renderer for BlockNote comment JSON.
 * Thin wrapper around BlockNoteRenderer that parses the JSON string
 * and applies comment-appropriate sizing.
 */
export function StaticCommentBody({ body }: { body: string }) {
  const blocks = parseCommentBody(body);
  return (
    <div className="text-sm">
      <BlockNoteRenderer blocks={blocks} />
    </div>
  );
}
