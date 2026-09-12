import * as Y from "yjs";
import { DOCUMENT_FRAGMENT } from "@ripple/shared/blockRef";

/** The cold-start snapshot of a document holding one paragraph. */
export function paragraphSnapshot(text: string): Uint8Array<ArrayBuffer> {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(DOCUMENT_FRAGMENT);
  const group = new Y.XmlElement("blockGroup");
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", "p1");
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  container.insert(0, [paragraph]);
  group.insert(0, [container]);
  fragment.insert(0, [group]);
  return new Uint8Array(Y.encodeStateAsUpdate(doc));
}

/**
 * The cold-start snapshot of a spreadsheet: `rows` of raw cell text, plus
 * computed values keyed "row,col" the way the room stores formula results.
 */
export function gridSnapshot(rows: string[][], formulaValues: Record<string, string> = {}): Uint8Array<ArrayBuffer> {
  const doc = new Y.Doc();
  const data = doc.getArray<Y.Map<string>>("data");
  const values = doc.getMap<string>("formulaValues");
  const rowOrder = doc.getArray<string>("rowOrder");
  const colOrder = doc.getArray<string>("colOrder");
  doc.transact(() => {
    rows.forEach((cells, r) => {
      const row = new Y.Map<string>();
      data.push([row]);
      cells.forEach((cell, c) => {
        if (cell !== "") row.set(String(c), cell);
      });
      rowOrder.push([`r${r}`]);
    });
    const width = Math.max(0, ...rows.map((cells) => cells.length));
    for (let c = 0; c < width; c++) colOrder.push([`c${c}`]);
    for (const [key, value] of Object.entries(formulaValues)) values.set(key, value);
  });
  return new Uint8Array(Y.encodeStateAsUpdate(doc));
}
