import { useMemo } from "react";

import { type Block, BlockNoteEditor, nodeToBlock } from "@blocknote/core";
import { SyncApi } from "@convex-dev/prosemirror-sync";
import { useTiptapSync } from "@convex-dev/prosemirror-sync/tiptap";
import { BlockNoteSyncOptions } from "@convex-dev/prosemirror-sync/blocknote";

export function useBlockNoteSync(syncApi: SyncApi, id: string, opts?: BlockNoteSyncOptions) {
  const sync = useTiptapSync(syncApi, id, opts);

  const editor = useMemo(() => {
    if (sync.initialContent === null) return null;
    const editor = BlockNoteEditor.create({
      ...opts?.editorOptions,
      _headless: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: Block<any, any, any>[] = [];

    // Convert the prosemirror document to BlockNote blocks.
    // inspired by https://github.com/TypeCellOS/BlockNote/blob/main/packages/server-util/src/context/ServerBlockNoteEditor.ts#L42
    const pmNode = editor.pmSchema.nodeFromJSON(sync.initialContent);

    if (pmNode.firstChild) {
      pmNode.firstChild.descendants((node) => {
        blocks.push(
          nodeToBlock(
            node,
            editor.schema.blockSchema,
            editor.schema.inlineContentSchema,
            editor.schema.styleSchema,
          ),
        );
        return false;
      });
    }
    return BlockNoteEditor.create({
      ...opts?.editorOptions,
      _tiptapOptions: {
        ...opts?.editorOptions?._tiptapOptions,
        extensions: [...(opts?.editorOptions?._tiptapOptions?.extensions ?? []), sync.extension],
      },
      initialContent: blocks.length > 0 ? blocks : undefined,
    });
  }, [sync.initialContent]);

  if (sync.isLoading) {
    return {
      editor: null,
      isLoading: true,
      /**
       * Create the document without waiting to hear from the server.
       * Warning: Only call this if you just created the document id.
       * It's safer to wait until loading is false.
       * It's also best practice to pass in the same initial content everywhere,
       * so if two clients create the same document id, they'll both end up
       * with the same initial content. Otherwise the second client will
       * throw an exception on the snapshot creation.
       */
      create: sync.create,
    } as const;
  }
  if (!editor) {
    return {
      editor: null,
      isLoading: false,
      create: sync.create!,
    } as const;
  }
  return {
    editor,
    isLoading: false,
    create: sync.create
  } as const;
}
