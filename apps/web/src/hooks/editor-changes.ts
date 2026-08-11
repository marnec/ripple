import type { BlockChange } from "./editor-types";

/**
 * Reads a pending transaction's block changes, returning `null` when BlockNote
 * refuses to describe them.
 *
 * `onBeforeChange` runs inside ProseMirror's `filterTransaction`, i.e. before
 * appended transactions — so the pending doc still holds nodes the UniqueID
 * plugin has not stamped yet: every block a split (Enter) or a paste just
 * created. Since 0.53 BlockNote's change detection resolves ids through
 * `getNodeId`, which throws `Node blockContainer does not have an ID` on those
 * nodes (0.51 read `node.attrs.id` and tolerated `undefined`). Thrown from
 * `filterTransaction`, that error takes the whole transaction down with it —
 * pressing Enter stopped inserting a line at all.
 *
 * A transaction we cannot inspect is one we cannot veto, so callers treat
 * `null` as "let it through".
 */
export function tryGetChanges(
  getChanges: () => BlockChange[],
): BlockChange[] | null {
  try {
    return getChanges();
  } catch {
    return null;
  }
}
