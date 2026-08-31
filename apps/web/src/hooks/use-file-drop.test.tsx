import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFileDrop } from "./use-file-drop";

afterEach(cleanup);

/**
 * The nesting matters: the chat pane wraps a BlockNote editor that installs
 * its own drop listener, so the hook has to claim the event in the capture
 * phase before anything inside it runs. `inner` stands in for that listener.
 */
function Harness({
  onDrop,
  onInnerDrop,
}: {
  onDrop: (files: File[]) => void;
  onInnerDrop: () => void;
}) {
  const { isDragging, dropProps } = useFileDrop(onDrop);
  return (
    <div data-testid="pane" {...dropProps}>
      {isDragging && <div data-testid="overlay" />}
      <div data-testid="inner" onDrop={onInnerDrop} onDragOver={onInnerDrop} />
    </div>
  );
}

function renderHarness() {
  const onDrop = vi.fn();
  const onInnerDrop = vi.fn();
  render(<Harness onDrop={onDrop} onInnerDrop={onInnerDrop} />);
  return {
    onDrop,
    onInnerDrop,
    pane: screen.getByTestId("pane"),
    inner: screen.getByTestId("inner"),
  };
}

const fileDrag = (files: File[] = []) => ({ files, types: ["Files"] });
/** What dragging selected text or an in-page element looks like. */
const textDrag = () => ({ files: [], types: ["text/plain"] });

const png = () => new File(["x"], "shot.png", { type: "image/png" });
const pdf = () => new File(["x"], "spec.pdf", { type: "application/pdf" });

describe("useFileDrop", () => {
  it("shows the drop state while files are dragged over and clears it on drop", () => {
    const { onDrop, pane, inner } = renderHarness();

    fireEvent.dragEnter(pane, { dataTransfer: fileDrag() });
    expect(screen.getByTestId("overlay")).toBeInTheDocument();

    fireEvent.drop(inner, { dataTransfer: fileDrag([pdf()]) });
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop.mock.calls[0][0][0]).toHaveProperty("name", "spec.pdf");
  });

  it("stays in the drop state while the pointer crosses children", () => {
    // The bug this guards: dragging from the message list onto a message fires
    // a `dragleave` for the list, which a plain boolean would take as "gone".
    const { pane, inner } = renderHarness();

    fireEvent.dragEnter(pane, { dataTransfer: fileDrag() });
    fireEvent.dragEnter(inner, { dataTransfer: fileDrag() });
    fireEvent.dragLeave(pane, { dataTransfer: fileDrag() });
    expect(screen.getByTestId("overlay")).toBeInTheDocument();

    fireEvent.dragLeave(inner, { dataTransfer: fileDrag() });
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
  });

  it("claims the drop before anything nested inside can handle it", () => {
    const { onInnerDrop, inner } = renderHarness();

    fireEvent.dragOver(inner, { dataTransfer: fileDrag() });
    fireEvent.drop(inner, { dataTransfer: fileDrag([png()]) });

    expect(onInnerDrop).not.toHaveBeenCalled();
  });

  it("leaves a drag that carries no files completely alone", () => {
    const { onDrop, onInnerDrop, pane, inner } = renderHarness();

    fireEvent.dragEnter(pane, { dataTransfer: textDrag() });
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();

    fireEvent.dragOver(inner, { dataTransfer: textDrag() });
    fireEvent.drop(inner, { dataTransfer: textDrag() });
    expect(onDrop).not.toHaveBeenCalled();
    expect(onInnerDrop).toHaveBeenCalled();
  });

  it("hands over every dropped file and lets the caller decide what to keep", () => {
    const { onDrop, pane } = renderHarness();

    fireEvent.drop(pane, { dataTransfer: fileDrag([png(), pdf()]) });

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop.mock.calls[0][0]).toHaveLength(2);
  });
});
