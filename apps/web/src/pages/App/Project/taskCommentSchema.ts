import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { UserMention } from "./CustomInlineContent/UserMention";
import { EventMention } from "../Chat/CustomInlineContent/EventMention";

// Task comments are minimal — only support @ mentions (users + events).
export const taskCommentSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    userMention: UserMention,
    eventMention: EventMention,
  },
});
