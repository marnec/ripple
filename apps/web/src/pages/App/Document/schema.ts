import { BlockNoteSchema } from "@blocknote/core";
import type { BlockNoteEditor } from "@blocknote/core";
import {
  richTextBlockSpecs,
  richTextInlineContentSpecs,
} from "@/lib/blocknote/rich-text-schema";
import { DiagramBlock } from "./CustomBlocks/DiagramBlock";
import { SpreadsheetLink, SpreadsheetCellRef } from "./CustomBlocks/SpreadsheetRef";
import { SpreadsheetRangeBlock } from "./CustomBlocks/SpreadsheetRangeBlock";
import { User } from "./CustomBlocks/UserBlock";
import { EventBlock } from "./CustomBlocks/EventBlock";
import { DocumentBlockEmbed } from "./CustomBlocks/DocumentBlockEmbed";

/** BlockNote schema for the document editor. */
export const documentSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...richTextBlockSpecs(),
    diagram: DiagramBlock(),
    spreadsheetRange: SpreadsheetRangeBlock(),
    documentBlockEmbed: DocumentBlockEmbed(),
  },
  inlineContentSpecs: {
    ...richTextInlineContentSpecs(),
    mention: User,
    eventMention: EventBlock,
    spreadsheetLink: SpreadsheetLink,
    spreadsheetCellRef: SpreadsheetCellRef,
  },
});

/** The editor type produced by useCreateBlockNote with documentSchema. */
export type DocumentSchemaEditor = BlockNoteEditor<
  (typeof documentSchema)["blockSchema"],
  (typeof documentSchema)["inlineContentSchema"],
  (typeof documentSchema)["styleSchema"]
>;
