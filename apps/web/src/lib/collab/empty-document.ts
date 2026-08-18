import * as Y from "yjs";
import { DOCUMENT_FRAGMENT } from "@ripple/shared/blockRef";

/**
 * The empty state of a BlockNote document, as one canonical Yjs update.
 *
 * BlockNote's fragment is not a flat list: its blocks live inside a single
 * `blockGroup` root element. y-prosemirror creates that root the first time a
 * client writes into an empty fragment — with that client's own Yjs identity.
 * Two clients that each start from empty therefore create *different* roots,
 * and a fragment with two roots is not a document BlockNote can represent: it
 * renders one of them (which one is arbitrary) and the next edit deletes the
 * other from the document for good.
 *
 * That happens whenever two clients begin typing in a genuinely new document
 * inside one round-trip of each other, and it used to happen to anyone who
 * opened a document the collaboration server was slow to answer for.
 *
 * The fix is to make "empty" a value rather than an absence. This update is
 * built once, under a fixed client id, so every client that applies it applies
 * *the same* root — applying it twice, or from ten devices, is a no-op. Edits
 * then land inside one shared structure and merge as siblings, which is the
 * outcome Yjs is good at.
 *
 * `apps/web/src/lib/spreadsheet-yjs-binding.ts` does the same thing for the
 * spreadsheet grid, for the same reason.
 */
export const EMPTY_DOCUMENT_UPDATE: Uint8Array = (() => {
  const doc = new Y.Doc();
  // Fixed id → this update is byte-identical and idempotent wherever it runs.
  // 1 is also what the spreadsheet bootstrap uses; the two never share a doc.
  doc.clientID = 1;
  const fragment = doc.getXmlFragment(DOCUMENT_FRAGMENT);
  const group = new Y.XmlElement("blockGroup");
  const container = new Y.XmlElement("blockContainer");
  // BlockNote's own id for the block of an empty editor. Block ids only have
  // to be unique within a document, so a constant is fine.
  container.setAttribute("id", "initialBlockId");
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.setAttribute("backgroundColor", "default");
  paragraph.setAttribute("textColor", "default");
  paragraph.setAttribute("textAlignment", "left");
  container.insert(0, [paragraph]);
  group.insert(0, [container]);
  fragment.insert(0, [group]);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
})();

/**
 * Give a document its shared empty root, if it has no root yet.
 *
 * Only safe to call on a replica that is **hydrated** — one holding the room's
 * actual state. On a replica that simply hasn't been told what the document
 * contains, this would plant a second root beside the real one, which is the
 * failure it exists to prevent.
 */
export function seedEmptyDocument(yDoc: Y.Doc, origin: unknown): boolean {
  if (yDoc.getXmlFragment(DOCUMENT_FRAGMENT).length > 0) return false;
  Y.applyUpdate(yDoc, EMPTY_DOCUMENT_UPDATE, origin);
  return true;
}
