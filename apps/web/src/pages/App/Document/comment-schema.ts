import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";

/**
 * Schema for document comment bodies. Shared by two sites that MUST agree, or
 * comment bodies render inconsistently:
 *  - the `CommentsExtension` (so BlockNote's `Thread` renders stored bodies with
 *    this schema), passed via `use-document-collaboration`'s `schema` option;
 *  - the fixed composer in the comments rail (`CommentComposer`).
 *
 * Default blocks only — comments are prose, not documents, so the app's custom
 * blocks (cell refs, embeds, frames) are intentionally excluded. Mentions are a
 * deferred follow-up (they need the suggestion-menu wiring task comments have).
 */
export const documentCommentSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
  },
});
