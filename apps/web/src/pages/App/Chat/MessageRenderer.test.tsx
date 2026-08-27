import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("MessageRenderer layout reservation", () => {
  // The image is decorative (`alt=""`), so it has no `img` role to query by.
  const renderImage = (props: Record<string, unknown>) =>
    render(<MessageRenderer blocks={[imageBlock(props)]} />).container.querySelector("img")!;

  it("reserves the image box from the stored dimensions, capped at the height limit", () => {
    const img = renderImage({ url: "thumb.png", width: 600, height: 400 });

    expect(img.style.aspectRatio).toBe("600 / 400");
    // At its natural 600px width the image would be 400 tall — over the 320px
    // cap — so the width is pulled back to the 320-tall equivalent.
    expect(img.style.width).toBe("480px");
    expect(img).not.toHaveClass("max-h-80");
  });

  it("narrows a tall image so the height cap never squashes it", () => {
    const img = renderImage({ url: "thumb.png", width: 300, height: 600 });

    // 320px tall at a 1:2 ratio = 160px wide.
    expect(img.style.width).toBe("160px");
  });

  it("falls back to the CSS clamp for messages sent before dimensions were recorded", () => {
    const img = renderImage({ url: "thumb.png" });

    expect(img.style.aspectRatio).toBe("");
    expect(img).toHaveClass("max-h-80");
  });

  it("holds the image hidden inside the reserved box until it loads, then fades it in", () => {
    const img = renderImage({ url: "thumb.png", width: 600, height: 400 });

    expect(img).toHaveClass("opacity-0");
    expect(img).not.toHaveClass("animate-fade-in");
    // The reserved box itself stays visible while the bytes are in flight.
    expect(img.closest("div")).toHaveClass("bg-muted/40");

    fireEvent.load(img);

    expect(img).toHaveClass("animate-fade-in");
    expect(img).not.toHaveClass("opacity-0");
  });

  it("still reveals an image whose fetch failed, rather than leaving a blank box", () => {
    const img = renderImage({ url: "thumb.png", width: 600, height: 400 });

    fireEvent.error(img);

    expect(img).toHaveClass("animate-fade-in");
  });
});

/** A table row's cells in the object shape the editor actually produces. */
const cellObjects = (texts: string[]) =>
  texts.map((text) => ({
    type: "tableCell",
    props: {},
    content: [{ type: "text", text, styles: {} }],
  }));

const tableBlock = (rows: unknown[][]): Block => ({
  type: "table",
  content: { type: "tableContent", rows: rows.map((cells) => ({ cells })) } as any,
});

describe("MessageRenderer tables", () => {
  it("renders a frozen spreadsheet range stored in BlockNote's tableCell shape", () => {
    // Regression: TableRenderer read cells as bare inline arrays and threw
    // "cell.map is not a function" on the first real table a message carried,
    // taking the whole channel route down with it.
    render(
      <MessageRenderer
        blocks={[tableBlock([cellObjects(["Q3", "Q4"]), cellObjects(["1200", "1450"])])]}
      />,
    );

    expect(screen.getByText("Q3")).toBeInTheDocument();
    expect(screen.getByText("1450")).toBeInTheDocument();
    expect(screen.getAllByRole("cell")).toHaveLength(4);
  });

  it("still renders the bare inline-array shape older bodies carry", () => {
    render(
      <MessageRenderer
        blocks={[tableBlock([[[{ type: "text", text: "legacy", styles: {} }]]])]}
      />,
    );

    expect(screen.getByText("legacy")).toBeInTheDocument();
  });

  it("honours a merged cell's span", () => {
    render(
      <MessageRenderer
        blocks={[
          tableBlock([
            [{ type: "tableCell", props: { colspan: 2 }, content: [{ type: "text", text: "wide", styles: {} }] }],
          ]),
        ]}
      />,
    );

    expect(screen.getByRole("cell", { name: "wide" })).toHaveAttribute("colspan", "2");
  });
});
