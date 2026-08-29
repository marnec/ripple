import { BlockNoteSchema } from "@blocknote/core";
import { shortFormBlockSpecs } from "@/lib/blocknote/short-form-schema";

/**
 * Schema for document comment bodies. Shared by two sites that MUST agree, or
 * comment bodies render inconsistently:
 *  - the `CommentsExtension` (so BlockNote's `Thread` renders stored bodies with
 *    this schema), passed via `use-document-collaboration`'s `schema` option;
 *  - the fixed composer in the comments rail (`CommentComposer`).
 *
 * The shared short-form block set (see `short-form-schema.ts`) — comments are
 * prose, not documents. Two exclusions matter and are load-bearing:
 *  - the app's custom blocks (cell refs, embeds, frames) are absent, so a
 *    comment cannot embed a document, spreadsheet or diagram;
 *  - so is every media block, so a comment cannot carry a file or an image.
 * Mentions are a deferred follow-up (they need the suggestion-menu wiring task
 * comments have).
 */
export const documentCommentSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...shortFormBlockSpecs(),
  },
});
