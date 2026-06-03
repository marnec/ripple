import { describe, expect, it } from "vitest";
import { frameViewElements, orderFrames, type FrameLike } from "./frames";

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

describe("frameViewElements", () => {
  const frame = { id: "F", type: "frame", x: 0, y: 0, width: 200, height: 200 };

  it("returns the frame + its members, excluding straddling non-members", () => {
    const els = [
      frame,
      { id: "m1", type: "rectangle", x: 10, y: 10, width: 20, height: 20, frameId: "F" },
      // Overlaps the frame edge but belongs to no frame — a neighbouring
      // cluster that must NOT be pulled into the frame's embed.
      { id: "straddle", type: "rectangle", x: 180, y: 10, width: 80, height: 20, frameId: null },
    ];
    expect(frameViewElements(els, "F").map((e) => e.id).sort()).toEqual(["F", "m1"]);
  });

  it("falls back to overlapping elements when the frame has no members", () => {
    const els = [
      frame,
      { id: "o1", type: "rectangle", x: 180, y: 10, width: 80, height: 20 }, // overlaps frame
      { id: "far", type: "rectangle", x: 500, y: 500, width: 20, height: 20 },
    ];
    expect(frameViewElements(els, "F").map((e) => e.id).sort()).toEqual(["F", "o1"]);
  });

  it("returns [] when the frame is missing", () => {
    expect(frameViewElements([frame], "nope")).toEqual([]);
  });
});
