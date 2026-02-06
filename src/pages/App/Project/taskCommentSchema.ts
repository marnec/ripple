import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { UserMention } from "./CustomInlineContent/UserMention";

// Task comments are minimal - only support @mentions
export const taskCommentSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    userMention: UserMention,
  },
});
