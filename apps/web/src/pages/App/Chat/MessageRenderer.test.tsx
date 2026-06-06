import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageRenderer, type Block } from "./MessageRenderer";

afterEach(cleanup);

const imageBlock = (props: Record<string, unknown>): Block => ({ type: "image", props });

describe("MessageRenderer diagram snapshots", () => {
  it("a diagram-snapshot image opens the lightbox like any image; the name label opens the diagram", async () => {
    const onImageClick = vi.fn();
    const onDiagramOpen = vi.fn();
    render(
      <MessageRenderer
        blocks={[imageBlock({ url: "thumb.png", fullUrl: "full.png", diagramId: "d1", diagramName: "Flowchart" })]}
        onImageClick={onImageClick}
        onDiagramOpen={onDiagramOpen}
      />,
    );

    // Clicking the name label opens the live diagram.
    await userEvent.click(screen.getByRole("button", { name: "Flowchart" }));
    expect(onDiagramOpen).toHaveBeenCalledWith("d1");
    expect(onImageClick).not.toHaveBeenCalled();

    // Clicking the image itself opens the lightbox.
    await userEvent.click(screen.getByRole("button", { name: "Open image" }));
    expect(onImageClick).toHaveBeenCalledWith("thumb.png", "full.png");
  });

  it("a plain image opens the lightbox and shows no diagram badge", async () => {
    const onImageClick = vi.fn();
    const onDiagramOpen = vi.fn();
    render(
      <MessageRenderer
        blocks={[imageBlock({ url: "thumb.png", fullUrl: "full.png" })]}
        onImageClick={onImageClick}
        onDiagramOpen={onDiagramOpen}
      />,
    );

    await userEvent.click(screen.getByRole("button"));

    expect(onImageClick).toHaveBeenCalledWith("thumb.png", "full.png");
    expect(onDiagramOpen).not.toHaveBeenCalled();
  });
});
