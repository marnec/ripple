import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { DiagramEmbed } from "./CustomInlineContent/DiagramEmbed";
import { DocumentLink } from "./CustomInlineContent/DocumentLink";
import { UserMention } from "./CustomInlineContent/UserMention";
import { ProjectReference } from "./CustomInlineContent/ProjectReference";

// Task descriptions are richer than chat messages. Keep all default block specs.
export const taskDescriptionSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    diagramEmbed: DiagramEmbed,
    documentLink: DocumentLink,
    userMention: UserMention,
    projectReference: ProjectReference,
  },
});
