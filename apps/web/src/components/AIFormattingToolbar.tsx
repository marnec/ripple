import {
  FormattingToolbar,
  getFormattingToolbarItems,
} from "@blocknote/react";
import { AIToolbarButton } from "@blocknote/xl-ai";

/**
 * The default formatting toolbar plus the AI entry point for the current
 * selection. Shared by the two writing surfaces that register the AI
 * extension — the document editor and the task description — so the button
 * sits in the same place on both. Only mount it inside a `BlockNoteView`
 * whose editor carries `AIExtension`; the button reads it from the editor.
 */
export function AIFormattingToolbar() {
  return (
    <FormattingToolbar>
      {...getFormattingToolbarItems()}
      <AIToolbarButton />
    </FormattingToolbar>
  );
}
