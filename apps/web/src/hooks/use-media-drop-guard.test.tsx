import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { useMediaDropGuard } from "./use-media-drop-guard";

/**
 * The guard exists because removing `file`/`audio`/`video` from the schema
 * does not remove them from the drop path: BlockNote falls back to inserting a
 * `file` block for any unmatched MIME type, which the schema no longer has. It
 * has to stop the event *in the capture phase*, before ProseMirror's own
 * listener on the inner editor node sees it — hence the nested target here.
 */
function Harness({ onInnerDrop }: { onInnerDrop: () => void }) {
  const guard = useMediaDropGuard("nope");
  return (
    <div {...guard}>
      <div data-testid="editor" onDrop={onInnerDrop} onPaste={onInnerDrop} />
    </div>
  );
}

function transfer(files: File[]) {
  return { files, types: files.length ? ["Files"] : [] };
}

function renderHarness() {
  const onInnerDrop = vi.fn();
  render(<Harness onInnerDrop={onInnerDrop} />);
  return { onInnerDrop, editor: screen.getByTestId("editor") };
}

afterEach(() => {
  cleanup();
  toastError.mockClear();
});

describe("useMediaDropGuard", () => {
  it("stops a dropped PDF before the editor sees it", () => {
    const { onInnerDrop, editor } = renderHarness();
    fireEvent.drop(editor, {
      dataTransfer: transfer([new File(["x"], "spec.pdf", { type: "application/pdf" })]),
    });
    expect(onInnerDrop).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("nope");
  });

  it("stops a mixed drop rather than letting the images through", () => {
    const { onInnerDrop, editor } = renderHarness();
    fireEvent.drop(editor, {
      dataTransfer: transfer([
        new File(["x"], "a.png", { type: "image/png" }),
        new File(["x"], "b.mp4", { type: "video/mp4" }),
      ]),
    });
    expect(onInnerDrop).not.toHaveBeenCalled();
  });

  it("lets an image drop through", () => {
    const { onInnerDrop, editor } = renderHarness();
    fireEvent.drop(editor, {
      dataTransfer: transfer([new File(["x"], "a.png", { type: "image/png" })]),
    });
    expect(onInnerDrop).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("lets an ordinary text paste through", () => {
    const { onInnerDrop, editor } = renderHarness();
    fireEvent.paste(editor, { clipboardData: transfer([]) });
    expect(onInnerDrop).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("stops a pasted audio file", () => {
    const { onInnerDrop, editor } = renderHarness();
    fireEvent.paste(editor, {
      clipboardData: transfer([new File(["x"], "a.mp3", { type: "audio/mpeg" })]),
    });
    expect(onInnerDrop).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("nope");
  });
});
