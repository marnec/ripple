import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  markdownToBlocks,
  markdownToYjsUpdate,
} from "../convex/lib/headlessEditor";

/**
 * Direct unit tests for the headless editor — the markdown → BlockNote / Yjs
 * conversion that was previously hand-rolled (and untested) inside three
 * separate actions. These exercise the JSDOM shim + BlockNote parse + Yjs
 * encoding without any Convex action harness.
 */
describe("headlessEditor", () => {
  describe("markdownToBlocks", () => {
    it("parses markdown into BlockNote blocks", async () => {
      const blocks = await markdownToBlocks("# Title\n\nHello **world**");
      expect(blocks.length).toBeGreaterThan(0);
      // The JSON must round-trip — this is what commentSeedAction stores.
      expect(() => JSON.stringify(blocks)).not.toThrow();
      const heading = blocks.find((b) => b.type === "heading");
      expect(heading).toBeDefined();
    });

    it("returns [] for blank input", async () => {
      expect(await markdownToBlocks("")).toEqual([]);
      expect(await markdownToBlocks("   \n  ")).toEqual([]);
    });

    it("restores the previous globals after running", async () => {
      const beforeWindow = (globalThis as { window?: unknown }).window;
      const beforeDocument = (globalThis as { document?: unknown }).document;
      await markdownToBlocks("some text");
      expect((globalThis as { window?: unknown }).window).toBe(beforeWindow);
      expect((globalThis as { document?: unknown }).document).toBe(
        beforeDocument,
      );
    });
  });

  describe("markdownToYjsUpdate", () => {
    it("encodes a non-empty Yjs update that decodes into the fragment", async () => {
      const update = await markdownToYjsUpdate("Hello world");
      expect(update).not.toBeNull();
      expect(update!.length).toBeGreaterThan(0);

      // The update must apply cleanly and populate the fragment every Ripple
      // collaborative editor binds to.
      //
      // The name is spelled out here on purpose rather than imported from
      // `DOCUMENT_FRAGMENT`. Using the constant would make this test agree with
      // whatever the constant happens to say, including a changed value that
      // would orphan every document already in storage. The literal is the
      // independent record of the stored format.
      const doc = new Y.Doc();
      Y.applyUpdate(doc, update!);
      expect(doc.getXmlFragment("document-store").length).toBeGreaterThan(0);
    });

    it("returns null for blank input (nothing to seed)", async () => {
      expect(await markdownToYjsUpdate("")).toBeNull();
      expect(await markdownToYjsUpdate("   ")).toBeNull();
    });

    it("restores the previous globals after running", async () => {
      const beforeWindow = (globalThis as { window?: unknown }).window;
      await markdownToYjsUpdate("text");
      expect((globalThis as { window?: unknown }).window).toBe(beforeWindow);
    });
  });
});
