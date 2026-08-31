import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { BlockPreview } from "@ripple/shared/blockRef";
import { getErrorMessage } from "@/lib/errors";
import {
  insertBlockEmbed,
  insertCellRefEmbed,
  type CellRefEmbedPick,
  type EmbedInsertEditor,
} from "@/lib/embed-insert";

/**
 * Inserting an embed, wired to this app.
 *
 * `lib/embed-insert` owns the sequence and stays free of React and of anything
 * that can put pixels on screen, which is what lets it be tested as a plain
 * function. What it cannot do from there is *tell the user* when the server
 * refuses to make a reference — so it rejects, and this is the one place that
 * turns the rejection into a toast. Both editors that insert embeds go through
 * here, so neither has to remember to.
 */
export function useEmbedInsert() {
  const ensureCellRef = useMutation(api.spreadsheetCellRefs.ensureCellRef);
  const ensureBlockRef = useMutation(api.documentBlockRefs.ensureBlockRef);
  const prepareStableRef = useAction(api.spreadsheetCellRefsNode.prepareStableRef);

  return {
    insertCellRef: (
      editor: EmbedInsertEditor,
      spreadsheetId: Id<"spreadsheets">,
      pick: CellRefEmbedPick,
    ) => {
      void insertCellRefEmbed({
        editor,
        spreadsheetId,
        pick,
        ensureCellRef,
        prepareStableRef,
      }).catch((error: unknown) => {
        toast.error("Couldn't reference that cell", {
          description: getErrorMessage(error),
        });
      });
    },

    insertBlock: (
      editor: EmbedInsertEditor,
      documentId: Id<"documents">,
      block: BlockPreview,
    ) => {
      insertBlockEmbed({ editor, documentId, block, ensureBlockRef });
    },
  };
}
