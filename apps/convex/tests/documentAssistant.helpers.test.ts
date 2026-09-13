import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import * as Y from "yjs";
import { DOCUMENT_FRAGMENT } from "@ripple/shared/blockRef";
import {
  corsHeaders,
  describeOperations,
  injectDocumentState,
  parseAssistantRequest,
  toolDefinitionsToToolSet,
  yjsSnapshotToText,
} from "../convex/lib/documentAssistant";

/**
 * The pure half of the document assistant route: request narrowing, the tool
 * hand-off to the editor, the document-state expansion the model reads, and
 * the snapshot reader the workspace tools use.
 */

const validBody = {
  documentId: "doc123",
  messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }],
  toolDefinitions: {
    applyDocumentOperations: {
      description: "apply",
      inputSchema: { type: "object", properties: { operations: { type: "array" } } },
      outputSchema: { type: "object" },
    },
  },
};

describe("parseAssistantRequest", () => {
  it("accepts the editor's request shape", () => {
    const parsed = parseAssistantRequest(validBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.target).toEqual({ type: "document", id: "doc123" });
    expect(parsed.value.messages).toHaveLength(1);
    expect(Object.keys(parsed.value.toolDefinitions)).toEqual(["applyDocumentOperations"]);
  });

  it("accepts a task description as the target", () => {
    const parsed = parseAssistantRequest({ ...validBody, documentId: undefined, taskId: "task9" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.target).toEqual({ type: "task", id: "task9" });
  });

  it.each([
    ["not an object", "nope"],
    ["missing documentId", { ...validBody, documentId: undefined }],
    ["empty taskId", { ...validBody, documentId: undefined, taskId: "" }],
    ["both a documentId and a taskId", { ...validBody, taskId: "task9" }],
    ["empty messages", { ...validBody, messages: [] }],
    ["message without parts", { ...validBody, messages: [{ id: "m", role: "user" }] }],
    ["toolDefinitions not an object", { ...validBody, toolDefinitions: [] }],
    [
      "tool without inputSchema",
      { ...validBody, toolDefinitions: { applyDocumentOperations: { description: "x" } } },
    ],
  ])("rejects %s", (_label, body) => {
    expect(parseAssistantRequest(body).ok).toBe(false);
  });
});

describe("toolDefinitionsToToolSet", () => {
  it("builds tools the model can call but the server never executes", () => {
    const parsed = parseAssistantRequest(validBody);
    if (!parsed.ok) throw new Error(parsed.error);
    const tools = toolDefinitionsToToolSet(parsed.value.toolDefinitions);
    const applied = tools.applyDocumentOperations;
    expect(applied).toBeDefined();
    expect(applied.description).toBe("apply");
    // No `execute`: the call has to travel back to the editor.
    expect(applied.execute).toBeUndefined();
    expect(applied.inputSchema).toBeDefined();
  });
});

describe("injectDocumentState", () => {
  const user = (id: string, metadata?: Record<string, unknown>): UIMessage => ({
    id,
    role: "user",
    parts: [{ type: "text", text: "rewrite this" }],
    metadata,
  });

  it("leaves messages without a snapshot alone", () => {
    const messages = [user("m1")];
    expect(injectDocumentState(messages)).toEqual(messages);
  });

  it("puts the whole-document state in front of a message without a selection", () => {
    const messages = [
      user("m1", {
        documentState: {
          selection: false,
          blocks: [{ id: "a$", block: "<p>one</p>", cursor: true }],
          isEmptyDocument: false,
        },
      }),
    ];
    const out = injectDocumentState(messages);
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe("assistant");
    expect(out[1]).toBe(messages[0]);
    const texts = out[0].parts.map((part) => (part.type === "text" ? part.text : ""));
    expect(texts.join("\n")).toContain("no active selection");
    expect(texts.join("\n")).toContain('"a$"');
  });

  it("puts the selection first when there is one", () => {
    const out = injectDocumentState([
      user("m1", {
        documentState: {
          selection: true,
          selectedBlocks: [{ id: "sel$", block: "<p>chosen</p>" }],
          blocks: [{ block: "<p>chosen</p>" }, { block: "<p>rest</p>" }],
          isEmptyDocument: false,
        },
      }),
    ]);
    const texts = out[0].parts.map((part) => (part.type === "text" ? part.text : ""));
    expect(texts[0]).toContain("current selection");
    expect(texts[1]).toContain('"sel$"');
    expect(texts.join("\n")).toContain("rest");
  });

  it("tells the model to fill the empty block first in an empty document", () => {
    const out = injectDocumentState([
      user("m1", {
        documentState: { selection: false, blocks: [], isEmptyDocument: true },
      }),
    ]);
    const texts = out[0].parts.map((part) => (part.type === "text" ? part.text : ""));
    expect(texts.join("\n")).toContain("empty");
  });
});

describe("describeOperations", () => {
  it("names what each operation addresses, never what it contains", () => {
    const line = describeOperations({
      operations: [
        {
          type: "add",
          referenceId: "abc$",
          position: "after",
          blocks: ["<p>secret one</p>", "<p>secret two</p>"],
        },
        { type: "update", id: "def$", block: "<p>secret three</p>" },
        { type: "delete", id: "ghi$" },
      ],
    });
    expect(line).toBe("3 operations: add after abc$ (2 blocks), update def$, delete ghi$");
    expect(line).not.toContain("secret");
  });

  it("says so when the call is not shaped like operations at all", () => {
    expect(describeOperations({ ops: [] })).toBe("no operations array");
    expect(describeOperations("garbage")).toBe("no operations array");
    expect(describeOperations({ operations: [{ type: "move" }, 42, { type: "update" }] })).toBe(
      '3 operations: unknown type "move", malformed, update ?',
    );
  });
});

describe("corsHeaders", () => {
  it("allows only the configured site", () => {
    const allowed = corsHeaders("https://app.example", "https://app.example");
    expect(allowed["Access-Control-Allow-Origin"]).toBe("https://app.example");
    expect(allowed["Access-Control-Allow-Headers"]).toContain("Authorization");

    expect(corsHeaders("https://evil.example", "https://app.example")).toEqual({
      Vary: "Origin",
    });
    expect(corsHeaders("https://app.example", undefined)).toEqual({ Vary: "Origin" });
  });
});

describe("yjsSnapshotToText", () => {
  /** Build the XML BlockNote writes, without needing BlockNote. */
  function block(
    type: string,
    text: string,
    attrs: Record<string, string> = {},
    children: Y.XmlElement[] = [],
  ): Y.XmlElement {
    const container = new Y.XmlElement("blockContainer");
    container.setAttribute("id", `${type}-${text.slice(0, 4)}`);
    const content = new Y.XmlElement(type);
    for (const [key, value] of Object.entries(attrs)) content.setAttribute(key, value);
    if (text) content.insert(0, [new Y.XmlText(text)]);
    container.insert(0, [content]);
    if (children.length > 0) {
      const group = new Y.XmlElement("blockGroup");
      group.insert(0, children);
      container.insert(1, [group]);
    }
    return container;
  }

  function snapshotOf(blocks: Y.XmlElement[]): Uint8Array {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment(DOCUMENT_FRAGMENT);
    const group = new Y.XmlElement("blockGroup");
    group.insert(0, blocks);
    fragment.insert(0, [group]);
    return Y.encodeStateAsUpdate(doc);
  }

  it("renders headings, lists, nesting, code and custom blocks", () => {
    const text = yjsSnapshotToText(
      snapshotOf([
        block("heading", "Plan", { level: "2" }),
        block("paragraph", "Intro"),
        block("bulletListItem", "first", {}, [block("bulletListItem", "nested")]),
        block("numberedListItem", "one"),
        block("numberedListItem", "two"),
        block("checkListItem", "done", { checked: "true" }),
        block("codeBlock", "let x = 1;", { language: "typescript" }),
        block("diagram", ""),
        block("paragraph", ""),
      ]),
    );
    expect(text.split("\n")).toEqual([
      "## Plan",
      "Intro",
      "- first",
      "  - nested",
      "1. one",
      "2. two",
      "- [x] done",
      "```typescript",
      "let x = 1;",
      "```",
      "[diagram]",
    ]);
  });

  it("returns an empty string for a snapshot with no content", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment(DOCUMENT_FRAGMENT);
    expect(yjsSnapshotToText(Y.encodeStateAsUpdate(doc))).toBe("");
  });
});
