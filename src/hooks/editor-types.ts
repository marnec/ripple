/** Minimal editor shape required by delete-protection hooks. */
export type AnyEditor = {
  isEditable: boolean;
  document: unknown[];
  domElement: HTMLElement | null | undefined;
  onBeforeChange: (
    callback: (context: {
      getChanges: () => Array<{
        block: { id: string; type: string; props: Record<string, unknown>; content?: unknown; children?: unknown[] };
        source: { type: string };
        type: string;
        prevBlock: unknown;
      }>;
    }) => boolean | void,
  ) => () => void;
  removeBlocks: (blocks: Array<{ id: string } | string>) => any;
  insertBlocks: (...args: any[]) => any;
  getTextCursorPosition: () => { block: { id: string } };
};
