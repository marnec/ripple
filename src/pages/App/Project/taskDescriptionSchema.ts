import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { DiagramBlock } from "../Document/CustomBlocks/DiagramBlock";
import { DiagramEmbed } from "./CustomInlineContent/DiagramEmbed";
import { DocumentLink } from "./CustomInlineContent/DocumentLink";
import { UserMention } from "./CustomInlineContent/UserMention";
import { ProjectReference } from "./CustomInlineContent/ProjectReference";

// Task descriptions are richer than chat messages. Keep all default block specs.
export const taskDescriptionSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    diagram: DiagramBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    diagramEmbed: DiagramEmbed,
    documentLink: DocumentLink,
    userMention: UserMention,
    projectReference: ProjectReference,
  },
});
