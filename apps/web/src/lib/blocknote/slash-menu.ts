// Slash-menu items for the writing surfaces (document + task description).
//
// The default items are derived from the editor's schema, so removing the
// media blocks already removes their entries. Math is the other way round:
// its specs live in an optional package, so `@blocknote/math-block` keeps its
// menu items out of the defaults and hands them over separately —
// `combineByGroup` drops them at the end of the group they declare
// ("Advanced"), rather than appending a group of their own.

import { combineByGroup, type BlockNoteEditor } from "@blocknote/core";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import { getMathSlashMenuItems } from "@blocknote/math-block";
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";

export async function getRichSlashMenuItems(
  editor: BlockNoteEditor<any, any, any>,
  query: string,
): Promise<DefaultReactSuggestionItem[]> {
  return filterSuggestionItems(
    combineByGroup(
      getDefaultReactSlashMenuItems(editor),
      getMathSlashMenuItems(editor),
    ),
    query,
  );
}
