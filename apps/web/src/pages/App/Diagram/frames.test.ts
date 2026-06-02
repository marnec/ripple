import { describe, expect, it } from "vitest";
import { orderFrames, type FrameLike } from "./frames";

function frame(id: string, x: number, y: number, w = 100, h = 100): FrameLike & { id: string } {
  return { id, type: "frame", x, y, width: w, height: h };
}

describe("orderFrames", () => {
  it("returns an empty array when there are no frames", () => {
    expect(orderFrames([])).toEqual([]);
    expect(orderFrames([{ type: "rectangle", x: 0, y: 0, width: 1, height: 1 }])).toEqual([]);
  });

  it("filters out non-frame elements", () => {
    const els = [
      frame("f1", 0, 0),
      { type: "ellipse", x: 5, y: 5, width: 10, height: 10 },
      frame("f2", 0, 200),
    ];
    expect(orderFrames(els).map((f) => (f as { id: string }).id)).toEqual(["f1", "f2"]);
  });

  it("orders a vertical stack top-to-bottom", () => {
    const els = [frame("b", 0, 300), frame("a", 0, 0), frame("c", 0, 600)];
    expect(orderFrames(els).map((f) => (f as { id: string }).id)).toEqual(["a", "b", "c"]);
  });

  it("orders a single row left-to-right", () => {
    const els = [frame("right", 400, 0), frame("left", 0, 10), frame("mid", 200, 5)];
    // y values differ slightly but all within half-height → same row.
    expect(orderFrames(els).map((f) => (f as { id: string }).id)).toEqual(["left", "mid", "right"]);
  });

  it("orders a grid in reading order (rows top-to-bottom, then left-to-right)", () => {
    const els = [
      frame("bottom-right", 400, 500),
      frame("top-right", 400, 0),
      frame("bottom-left", 0, 500),
      frame("top-left", 0, 0),
    ];
    expect(orderFrames(els).map((f) => (f as { id: string }).id)).toEqual([
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]);
  });
});
