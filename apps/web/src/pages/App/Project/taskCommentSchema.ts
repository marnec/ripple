import { BlockNoteSchema, defaultInlineContentSpecs } from "@blocknote/core";
import { shortFormBlockSpecs } from "@/lib/blocknote/short-form-schema";
import { UserMention } from "./CustomInlineContent/UserMention";
import { EventMention } from "../Chat/CustomInlineContent/EventMention";

// Task comments are minimal: the shared short-form block set (no media, no
// headings — see `short-form-schema.ts`) plus @ mentions of users and events.
// No resource inline content, so a comment cannot embed a document,
// spreadsheet or diagram — `short-form-schema.test.ts` holds that in place.
export const taskCommentSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...shortFormBlockSpecs(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    userMention: UserMention,
    eventMention: EventMention,
  },
});
