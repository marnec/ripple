import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { ConnectionStatus } from "./ConnectionStatus";
import { DiagramBlock } from "./CustomBlocks/DiagramBlock";
import { SpreadsheetLink, SpreadsheetCellRef } from "./CustomBlocks/SpreadsheetRef";
import { SpreadsheetRangeBlock } from "./CustomBlocks/SpreadsheetRangeBlock";
import { User } from "./CustomBlocks/UserBlock";

const schema = BlockNoteSchema.create({
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

/** Read-only offline fallback for cold-start scenarios (no editor, no IndexedDB). */
export function SnapshotFallback({
  snapshotDoc,
  documentName,
  resolvedTheme,
}: {
  snapshotDoc: Y.Doc;
  documentName: string | undefined;
  resolvedTheme: string | undefined;
}) {
  const fragment = snapshotDoc.getXmlFragment("document-store");
  const fakeProvider = { awareness: new Awareness(snapshotDoc) } as any;

  const snapshotEditor = useCreateBlockNote({
    schema,
    collaboration: {
      fragment,
      provider: fakeProvider,
      user: { name: "", color: "" },
    },
  });

  return (
    <div className="h-full flex-1 min-w-0 overflow-y-scroll scrollbar-sleek">
      <div className="px-20 max-w-full animate-fade-in">
        <div className="sticky top-0 z-10 flex items-center justify-end gap-3 pt-5 pb-2">
          <ConnectionStatus isConnected={false} />
        </div>
        <h2 className="text-3xl pb-12 font-semibold">{documentName}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Viewing saved version (offline)
        </p>
        <BlockNoteView
          editor={snapshotEditor}
          editable={false}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
        />
      </div>
    </div>
  );
}
