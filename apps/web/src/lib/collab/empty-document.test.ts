import { BlockNoteEditor } from "@blocknote/core";
import { withCollaboration } from "@blocknote/core/yjs";
import { beforeEach, describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { DOCUMENT_FRAGMENT } from "@ripple/shared/blockRef";
import { EMPTY_DOCUMENT_UPDATE, seedEmptyDocument } from "./empty-document";

/**
 * What happens to a document's content when replicas that disagree about it
 * meet again.
 *
 * These tests are at the Yjs/BlockNote level rather than the React level on
 * purpose: reconciliation is a property of the data, and the interesting cases
 * (a device that has never seen the document, two devices starting from empty
 * at once) are combinations of replica states, not of components.
 *
 * The vocabulary used throughout:
 *   - **hydrated replica** — holds the room's state, from a sync, an offline
 *     cache, or a stored snapshot.
 *   - **unhydrated replica** — an empty Y.Doc that is empty because nobody has
 *     told it anything, not because the document is empty. The two are
 *     indistinguishable inside Yjs, which is the whole problem.
 */

const ORIGIN = Symbol("test");

function editorOn(doc: Y.Doc) {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      collaboration: {
        fragment: doc.getXmlFragment(DOCUMENT_FRAGMENT),
        provider: { awareness: new Awareness(doc) },
        user: { name: "Tester", color: "#000000" },
      },
    }),
  );
  editor.mount(document.createElement("div"));
  return editor;
}

/** Author blocks into a replica the way a user typing would. */
function type(doc: Y.Doc, ...paragraphs: string[]) {
  const editor = editorOn(doc);
  editor.replaceBlocks(
    editor.document,
    paragraphs.map((content) => ({ type: "paragraph", content })) as never,
  );
  return editor;
}

/** Every piece of text the fragment holds, regardless of structure. */
function allText(doc: Y.Doc): string {
  return doc.getXmlFragment(DOCUMENT_FRAGMENT).toJSON().replace(/<[^>]*>/g, "");
}

/** What BlockNote actually renders — which is not the same thing. */
function visibleText(doc: Y.Doc): string[] {
  return editorOn(doc)
    .document.map((block) => {
      const content = (block as { content?: { text?: string }[] }).content;
      return content?.map((c) => c.text ?? "").join("") ?? "";
    })
    .filter(Boolean);
}

function roots(doc: Y.Doc): number {
  return doc.getXmlFragment(DOCUMENT_FRAGMENT).length;
}

/** Exchange full state both ways, as a reconnect does. */
function reconcile(a: Y.Doc, b: Y.Doc) {
  const fromA = Y.encodeStateAsUpdate(a);
  const fromB = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, fromB);
  Y.applyUpdate(b, fromA);
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("the hazard the empty-document seed exists to remove", () => {
  /**
   * The failure this whole mechanism is built around. A BlockNote document is
   * a single `blockGroup` root containing blocks; y-prosemirror creates that
   * root the first time a client writes into an empty fragment, under that
   * client's own Yjs identity. Two clients that each start from empty create
   * two different roots, and Yjs — correctly — keeps both.
   */
  it("an unhydrated replica that is written to creates a rival root", () => {
    const server = new Y.Doc();
    type(server, "SERVER LINE 1", "SERVER LINE 2");

    // A device that has never seen this document: empty, and with no way to
    // know that "empty" is not the answer.
    const cold = new Y.Doc();
    expect(roots(cold)).toBe(0);
    type(cold, "TYPED WHILE UNAWARE");

    const merged = new Y.Doc();
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(cold));

    // Both texts survive in the CRDT…
    expect(allText(merged)).toContain("SERVER LINE 1");
    expect(allText(merged)).toContain("TYPED WHILE UNAWARE");
    // …but as two roots, which is not a document BlockNote can represent.
    expect(roots(merged)).toBe(2);
    // So it renders one side and silently drops the other.
    const visible = visibleText(merged);
    expect(visible.length).toBeLessThan(3);
  });

  /**
   * And the loss is not merely visual. ProseMirror normalises the document it
   * was handed, so the first edit after the merge writes the surviving root
   * back as the whole document — deleting the other from the Y.Doc, and from
   * the snapshot persisted after it.
   */
  it("the next edit deletes the losing root from the document for good", () => {
    const server = new Y.Doc();
    type(server, "SERVER LINE 1", "SERVER LINE 2");
    const cold = new Y.Doc();
    type(cold, "TYPED WHILE UNAWARE");

    const merged = new Y.Doc();
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(cold));
    expect(roots(merged)).toBe(2);

    const editor = editorOn(merged);
    editor.insertBlocks(
      [{ type: "paragraph", content: "ANYTHING AT ALL" } as never],
      editor.document[0],
      "after",
    );

    expect(roots(merged)).toBe(1);
    // One of the two contributions is now gone from the data, not just hidden.
    const survivingText = allText(merged);
    const lostServerContent = !survivingText.includes("SERVER LINE 1");
    const lostColdContent = !survivingText.includes("TYPED WHILE UNAWARE");
    expect(lostServerContent || lostColdContent).toBe(true);
  });
});

describe("seedEmptyDocument", () => {
  it("gives every replica the same root, so bootstrapping twice is a no-op", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedEmptyDocument(a, ORIGIN);
    seedEmptyDocument(b, ORIGIN);

    const merged = new Y.Doc();
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(b));

    expect(roots(merged)).toBe(1);
  });

  it("applying it a second time to the same document changes nothing", () => {
    const doc = new Y.Doc();
    expect(seedEmptyDocument(doc, ORIGIN)).toBe(true);
    const afterFirst = Y.encodeStateAsUpdate(doc);

    expect(seedEmptyDocument(doc, ORIGIN)).toBe(false);
    Y.applyUpdate(doc, EMPTY_DOCUMENT_UPDATE, ORIGIN);

    expect(roots(doc)).toBe(1);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(afterFirst);
  });

  it("leaves a document that already has content alone", () => {
    const doc = new Y.Doc();
    type(doc, "EXISTING");
    expect(seedEmptyDocument(doc, ORIGIN)).toBe(false);
    expect(roots(doc)).toBe(1);
    expect(allText(doc)).toContain("EXISTING");
  });

  it("reads as an empty editor, not as a document with a stray block", () => {
    const doc = new Y.Doc();
    seedEmptyDocument(doc, ORIGIN);
    const editor = editorOn(doc);
    expect(editor.document).toHaveLength(1);
    expect(visibleText(doc)).toEqual([]);
  });

  it("is tagged with the origin it was given, so edit detection can ignore it", () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on("update", (_update: Uint8Array, origin: unknown) => origins.push(origin));
    seedEmptyDocument(doc, ORIGIN);
    expect(origins).toEqual([ORIGIN]);
  });
});

describe("two clients starting from a genuinely new document", () => {
  /**
   * This one does not need anybody to be offline. Two people opening a new
   * document and typing within one round-trip of each other both write into an
   * empty fragment, and produce the same rival-root collision — which is why
   * the seed is applied on the connected path too, not only the offline one.
   */
  it("converge losslessly once both have bootstrapped the shared root", () => {
    const alice = new Y.Doc();
    const bob = new Y.Doc();
    seedEmptyDocument(alice, ORIGIN);
    seedEmptyDocument(bob, ORIGIN);

    const aliceEditor = editorOn(alice);
    aliceEditor.insertBlocks(
      [{ type: "paragraph", content: "ALICE" } as never],
      aliceEditor.document[0],
      "after",
    );
    const bobEditor = editorOn(bob);
    bobEditor.insertBlocks(
      [{ type: "paragraph", content: "BOB" } as never],
      bobEditor.document[0],
      "after",
    );

    reconcile(alice, bob);

    expect(roots(alice)).toBe(1);
    expect(allText(alice)).toContain("ALICE");
    expect(allText(alice)).toContain("BOB");
    // Both replicas agree, byte for byte.
    expect(Y.encodeStateAsUpdate(alice)).toEqual(Y.encodeStateAsUpdate(bob));
  });
});

describe("offline edits on a hydrated replica", () => {
  /**
   * The case the product is actually meant to support: you opened the document
   * before, so your device holds it, and you keep working on a plane. Nothing
   * here is ambiguous — both sides share the root and edits merge as siblings.
   */
  it("merge into the shared document without losing either side", () => {
    const server = new Y.Doc();
    seedEmptyDocument(server, ORIGIN);
    const serverEditor = editorOn(server);
    serverEditor.insertBlocks(
      [{ type: "paragraph", content: "WRITTEN BEFORE THE FLIGHT" } as never],
      serverEditor.document[0],
      "after",
    );

    // The device's cache: everything the server had at the time.
    const device = new Y.Doc();
    Y.applyUpdate(device, Y.encodeStateAsUpdate(server));

    // Offline here…
    const deviceEditor = editorOn(device);
    deviceEditor.insertBlocks(
      [{ type: "paragraph", content: "WRITTEN ON THE PLANE" } as never],
      deviceEditor.document.at(-1)!,
      "after",
    );
    // …and a colleague there.
    const colleagueEditor = editorOn(server);
    colleagueEditor.insertBlocks(
      [{ type: "paragraph", content: "WRITTEN AT THE OFFICE" } as never],
      colleagueEditor.document.at(-1)!,
      "after",
    );

    reconcile(server, device);

    for (const doc of [server, device]) {
      expect(roots(doc)).toBe(1);
      expect(allText(doc)).toContain("WRITTEN BEFORE THE FLIGHT");
      expect(allText(doc)).toContain("WRITTEN ON THE PLANE");
      expect(allText(doc)).toContain("WRITTEN AT THE OFFICE");
    }
    // Neither side "wins": the answer is that both are kept, and both replicas
    // end up with the same document.
    expect(Y.encodeStateAsUpdate(server)).toEqual(Y.encodeStateAsUpdate(device));
  });

  it("converge the same way whichever side reconnects first", () => {
    const base = new Y.Doc();
    seedEmptyDocument(base, ORIGIN);
    const baseEditor = editorOn(base);
    baseEditor.insertBlocks(
      [{ type: "paragraph", content: "SHARED" } as never],
      baseEditor.document[0],
      "after",
    );
    const baseState = Y.encodeStateAsUpdate(base);

    const makeBranch = (text: string) => {
      const branch = new Y.Doc();
      Y.applyUpdate(branch, baseState);
      const editor = editorOn(branch);
      editor.insertBlocks(
        [{ type: "paragraph", content: text } as never],
        editor.document.at(-1)!,
        "after",
      );
      return Y.encodeStateAsUpdate(branch);
    };
    const left = makeBranch("LEFT");
    const right = makeBranch("RIGHT");

    const leftFirst = new Y.Doc();
    Y.applyUpdate(leftFirst, left);
    Y.applyUpdate(leftFirst, right);

    const rightFirst = new Y.Doc();
    Y.applyUpdate(rightFirst, right);
    Y.applyUpdate(rightFirst, left);

    expect(allText(leftFirst)).toEqual(allText(rightFirst));
    expect(visibleText(leftFirst)).toEqual(visibleText(rightFirst));
  });
});

describe("hydrating from a stored snapshot", () => {
  /**
   * The cold-start path: the collaboration server is unreachable but Convex
   * still has the snapshot it persisted. Those bytes carry the room's own
   * client ids, so merging them locally and later receiving the same state
   * from the room is one document, not two.
   */
  it("is idempotent with the sync that eventually arrives", () => {
    const room = new Y.Doc();
    seedEmptyDocument(room, ORIGIN);
    const roomEditor = editorOn(room);
    roomEditor.insertBlocks(
      [{ type: "paragraph", content: "PERSISTED" } as never],
      roomEditor.document[0],
      "after",
    );
    const snapshot = Y.encodeStateAsUpdate(room);

    // Cold device hydrates from the snapshot instead of from the room.
    const device = new Y.Doc();
    Y.applyUpdate(device, snapshot, ORIGIN);
    const deviceEditor = editorOn(device);
    deviceEditor.insertBlocks(
      [{ type: "paragraph", content: "ADDED OFFLINE" } as never],
      deviceEditor.document.at(-1)!,
      "after",
    );

    // The room comes back and sends the same state again.
    reconcile(room, device);

    expect(roots(device)).toBe(1);
    expect(allText(device)).toContain("PERSISTED");
    expect(allText(device)).toContain("ADDED OFFLINE");
    expect(visibleText(device).filter((t) => t === "PERSISTED")).toHaveLength(1);
    expect(Y.encodeStateAsUpdate(room)).toEqual(Y.encodeStateAsUpdate(device));
  });

  it("does not conflict with the seed a hydrated peer may already have applied", () => {
    // A room whose document is genuinely empty, bootstrapped by a peer.
    const room = new Y.Doc();
    seedEmptyDocument(room, ORIGIN);
    const snapshot = Y.encodeStateAsUpdate(room);

    // A cold device restores that snapshot and then bootstraps too, because
    // the fragment it restored happens to be an empty document.
    const device = new Y.Doc();
    Y.applyUpdate(device, snapshot, ORIGIN);
    expect(seedEmptyDocument(device, ORIGIN)).toBe(false);
    expect(roots(device)).toBe(1);
  });
});
