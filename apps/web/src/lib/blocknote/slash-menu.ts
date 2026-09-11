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

/**
 * `extra` is for items one surface has and the other does not — the document
 * editor's AI commands, which need an extension the task editor does not
 * register. They join by group like the math items.
 */
export async function getRichSlashMenuItems(
  editor: BlockNoteEditor<any, any, any>,
  query: string,
  extra: DefaultReactSuggestionItem[] = [],
): Promise<DefaultReactSuggestionItem[]> {
  return filterSuggestionItems(
    combineByGroup(
      getDefaultReactSlashMenuItems(editor),
      getMathSlashMenuItems(editor),
      extra,
    ),
    query,
  );
}
