import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MessageRenderer, type Block } from "./MessageRenderer";

/**
 * The chip is the one part of the card that talks to Convex and the router; it
 * has its own behaviour and is not what these tests are about. What is under
 * test is the pairing rule — which chip-plus-table pairs become one card — and
 * the grid the card draws.
 */
vi.mock("./ResourceReferenceChip", () => ({
  ResourceReferenceChip: ({ cellRef }: { cellRef?: string }) => (
    <span data-testid="chip">{cellRef}</span>
  ),
}));

afterEach(cleanup);

const chip = (cellRef: string, resourceType = "spreadsheet") => ({
  type: "resourceReference" as const,
  props: {
    resourceId: "sheet-1",
    resourceType,
    resourceName: "Q3 costs",
    cellRef,
  },
});

const text = (value: string) => ({ type: "text" as const, text: value, styles: {} });

const tableOf = (rows: string[][]): Block => ({
  type: "table",
  content: {
    type: "tableContent",
    rows: rows.map((row) => ({
      cells: row.map((value) => ({
        type: "tableCell",
        props: {},
        content: [text(value)],
      })),
    })),
  },
});

const grid = () => document.querySelector("figure table");

describe("frozen spreadsheet ranges in a message", () => {
  it("draws the chip and the table under it as one card", () => {
    render(
      <MessageRenderer
        blocks={[
          { type: "paragraph", content: [chip("B2:C3")] },
          tableOf([
            ["Region", "Revenue"],
            ["North", "1,204"],
          ]),
        ]}
      />,
    );

    const figure = document.querySelector("figure");
    expect(figure).not.toBeNull();
    // The chip moved into the card rather than being left in a paragraph above.
    expect(figure!.querySelector("[data-testid=chip]")?.textContent).toBe("B2:C3");
    expect(figure!.querySelectorAll("table")).toHaveLength(1);
    expect(screen.getByText("1,204")).toBeTruthy();
  });

  it("keeps the words the sender typed before the chip", () => {
    render(
      <MessageRenderer
        blocks={[
          { type: "paragraph", content: [text("numbers so far "), chip("B2:C3")] },
          tableOf([["North", "1,204"]]),
        ]}
      />,
    );

    expect(screen.getByText("numbers so far")).toBeTruthy();
    expect(grid()).not.toBeNull();
  });

  it("promotes a label row to a real table header", () => {
    render(
      <MessageRenderer
        blocks={[
          { type: "paragraph", content: [chip("A1:B2")] },
          tableOf([
            ["Region", "Revenue"],
            ["North", "1,204"],
          ]),
        ]}
      />,
    );

    const headers = [...document.querySelectorAll("figure th")].map((th) => th.textContent);
    expect(headers).toEqual(["Region", "Revenue"]);
  });

  it("right-aligns the numbers and leaves the labels alone", () => {
    render(
      <MessageRenderer
        blocks={[
          { type: "paragraph", content: [chip("A1:B1")] },
          tableOf([["North", "1,204"]]),
        ]}
      />,
    );

    const cells = [...document.querySelectorAll("figure td")];
    expect(cells[0].className).toContain("text-left");
    expect(cells[1].className).toContain("text-right");
    expect(cells[1].className).toContain("tabular-nums");
  });

  it("leaves a table that no spreadsheet chip introduces as a plain table", () => {
    render(
      <MessageRenderer
        blocks={[
          { type: "paragraph", content: [chip("", "document")] },
          tableOf([["a", "b"]]),
        ]}
      />,
    );

    expect(document.querySelector("figure")).toBeNull();
    expect(document.querySelector("table")).not.toBeNull();
  });

  it("leaves a chip that no table follows as a plain chip", () => {
    render(<MessageRenderer blocks={[{ type: "paragraph", content: [chip("B2:C3")] }]} />);

    expect(document.querySelector("figure")).toBeNull();
    expect(screen.getByTestId("chip")).toBeTruthy();
  });
});
