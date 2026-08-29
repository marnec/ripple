import { BlockNoteSchema } from "@blocknote/core";
import {
  richTextBlockSpecs,
  richTextInlineContentSpecs,
} from "@/lib/blocknote/rich-text-schema";
import { DiagramBlock } from "../Document/CustomBlocks/DiagramBlock";
import { DocumentBlockEmbed } from "../Document/CustomBlocks/DocumentBlockEmbed";
import { SpreadsheetRangeBlock } from "../Document/CustomBlocks/SpreadsheetRangeBlock";
import { SpreadsheetLink, SpreadsheetCellRef } from "../Document/CustomBlocks/SpreadsheetRef";
import { DiagramEmbed } from "./CustomInlineContent/DiagramEmbed";
import { DocumentLink } from "./CustomInlineContent/DocumentLink";
import { UserMention } from "./CustomInlineContent/UserMention";
import { ProjectReference } from "./CustomInlineContent/ProjectReference";
import { EventMention } from "../Chat/CustomInlineContent/EventMention";

// Task descriptions are richer than chat messages: they share the document
// editor's block set (defaults minus the media blocks, plus math) and add the
// task-flavoured embeds and mentions on top.
export const taskDescriptionSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...richTextBlockSpecs(),
    diagram: DiagramBlock(),
    documentBlockEmbed: DocumentBlockEmbed(),
    spreadsheetRange: SpreadsheetRangeBlock(),
  },
  inlineContentSpecs: {
    ...richTextInlineContentSpecs(),
    diagramEmbed: DiagramEmbed,
    documentLink: DocumentLink,
    userMention: UserMention,
    projectReference: ProjectReference,
    spreadsheetLink: SpreadsheetLink,
    spreadsheetCellRef: SpreadsheetCellRef,
    eventMention: EventMention,
  },
});
