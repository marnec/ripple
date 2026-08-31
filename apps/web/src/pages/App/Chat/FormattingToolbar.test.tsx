import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormattingToolbar } from "./FormattingToolbar";

afterEach(cleanup);

function mountToolbar() {
  const editor = BlockNoteEditor.create();
  editor.mount(document.createElement("div"));
  render(
    <FormattingToolbar
      editor={editor}
      canAttach={false}
      onAttachImage={() => {}}
      onAttachFile={() => {}}
    />,
  );
  return editor;
}

/** The link inline content of the first block, if it has one. */
function firstLink(editor: BlockNoteEditor) {
  const content = editor.document[0].content;
  if (!Array.isArray(content)) return undefined;
  return content.find((c) => c.type === "link") as
    | { href: string; content: { text: string }[] }
    | undefined;
}

const openLinkEditor = () => userEvent.click(screen.getByRole("button", { name: "Link" }));

/**
 * Move the editor's text selection, in ProseMirror positions.
 *
 * `prosemirror-state` is only a transitive dependency here, so the selection
 * class is taken from the live selection rather than imported.
 */
function select(editor: BlockNoteEditor, from: number, to = from) {
  editor.transact((tr) => {
    const TextSelection = tr.selection.constructor as unknown as {
      create: (doc: typeof tr.doc, anchor: number, head: number) => typeof tr.selection;
    };
    tr.setSelection(TextSelection.create(tr.doc, from, to));
  });
}

/** Select the text just inserted at the caret. */
function selectInserted(editor: BlockNoteEditor, text: string) {
  const end = editor.prosemirrorState.selection.from;
  select(editor, end - text.length, end);
}

/**
 * Put the caret inside the first link in the document — not at its edges: the
 * link mark is non-inclusive, so a caret at either boundary is deliberately
 * "outside" the link, which is what lets you type ordinary text right after one.
 */
function putCaretInsideLink(editor: BlockNoteEditor) {
  for (let pos = 1; pos < editor.prosemirrorState.doc.content.size; pos++) {
    if (editor.getLinkMarkAtPos(pos)) {
      select(editor, pos);
      return;
    }
  }
  throw new Error("no link in the document");
}

describe("chat link button", () => {
  it("inserts a link with its own text when nothing is selected", async () => {
    // The button used to be dead here: BlockNote's `createLink` ignores a call
    // with no text and no selection, so pressing it did nothing at all.
    const editor = mountToolbar();

    await openLinkEditor();
    await userEvent.type(screen.getByLabelText("Link URL"), "example.com");
    await userEvent.type(screen.getByLabelText("Link text"), "the docs");
    await userEvent.click(screen.getByRole("button", { name: "Add link" }));

    expect(firstLink(editor)).toMatchObject({
      href: "https://example.com/",
      content: [{ text: "the docs" }],
    });
  });

  it("uses the selected text as the link's label, never as its address", async () => {
    // The reported bug: the button passed the selected text straight to
    // `createLink` as the URL, so selecting "click here" produced
    // `<a href="click here">` — a relative link the SPA resolved against the
    // channel route and answered with a not-found page.
    const editor = mountToolbar();
    act(() => {
      editor.insertInlineContent("click here");
      selectInserted(editor, "click here");
    });

    await openLinkEditor();
    // With a selection there is nothing to name: the selection is the label.
    expect(screen.queryByLabelText("Link text")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Link URL"), "example.com/docs");
    await userEvent.click(screen.getByRole("button", { name: "Add link" }));

    expect(firstLink(editor)).toMatchObject({
      href: "https://example.com/docs",
      content: [{ text: "click here" }],
    });
  });

  it("assumes https rather than leaving a bare word as a relative link", async () => {
    const editor = mountToolbar();

    await openLinkEditor();
    await userEvent.type(screen.getByLabelText("Link URL"), "acme");
    await userEvent.click(screen.getByRole("button", { name: "Add link" }));

    expect(firstLink(editor)?.href).toBe("https://acme/");
  });

  it("refuses a relative URL instead of creating a link into the app's own routes", async () => {
    const editor = mountToolbar();

    await openLinkEditor();
    await userEvent.type(screen.getByLabelText("Link URL"), "/workspace/settings");
    await userEvent.click(screen.getByRole("button", { name: "Add link" }));

    expect(firstLink(editor)).toBeUndefined();
    expect(screen.getByText(/full address/i)).toBeInTheDocument();
  });

  it("reads as active with the caret in a link, and edits that link", async () => {
    const editor = mountToolbar();
    act(() => {
      editor.insertInlineContent([{ type: "link", href: "https://old.example", content: "site" }]);
      putCaretInsideLink(editor);
    });

    const button = screen.getByRole("button", { name: "Link" });
    expect(button).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(button);
    const url = screen.getByLabelText("Link URL");
    expect(url).toHaveValue("https://old.example");
    await userEvent.clear(url);
    await userEvent.type(url, "https://new.example/docs");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(firstLink(editor)?.href).toBe("https://new.example/docs");
  });
});
