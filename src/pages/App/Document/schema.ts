import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import type { BlockNoteEditor } from "@blocknote/core";
import { DiagramBlock } from "./CustomBlocks/DiagramBlock";
import { SpreadsheetLink, SpreadsheetCellRef } from "./CustomBlocks/SpreadsheetRef";
import { SpreadsheetRangeBlock } from "./CustomBlocks/SpreadsheetRangeBlock";
import { User } from "./CustomBlocks/UserBlock";

/** BlockNote schema shared by DocumentEditor and SnapshotFallback. */
export const documentSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    diagram: DiagramBlock(),
    spreadsheetRange: SpreadsheetRangeBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: User,
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
