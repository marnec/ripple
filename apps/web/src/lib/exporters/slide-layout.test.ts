import { describe, expect, it } from "vitest";
import { deckSize, fitContain } from "./slide-layout";

describe("deckSize", () => {
  it("maps a 16:9 frame onto PowerPoint's own widescreen size", () => {
    const size = deckSize({ width: 1920, height: 1080 });
    expect(size.width).toBeCloseTo(13.333, 3);
    expect(size.height).toBeCloseTo(7.5, 3);
  });

  it("keeps the frame's aspect ratio for other landscape shapes", () => {
    const size = deckSize({ width: 1000, height: 500 });
    expect(size.width / size.height).toBeCloseTo(2, 5);
  });

  it("pins height instead of width for portrait frames", () => {
    const size = deckSize({ width: 500, height: 1000 });
    expect(size.height).toBeCloseTo(7.5, 3);
    expect(size.width).toBeCloseTo(3.75, 3);
  });

  it("falls back to widescreen for a degenerate canvas", () => {
    expect(deckSize({ width: 0, height: 0 })).toEqual({ width: 13.333, height: 7.5 });
  });

  it("clamps extreme aspect ratios into PowerPoint's legal range", () => {
    const wide = deckSize({ width: 100000, height: 1 });
    expect(wide.height).toBe(1);
    const tall = deckSize({ width: 1, height: 100000 });
    expect(tall.width).toBe(1);
  });
});

describe("fitContain", () => {
  const slide = { width: 13.333, height: 7.5 };

  it("fills the slide when the aspect ratios match", () => {
    // 13.333 is PowerPoint's own rounding of 16:9, so the fit is exact to ~3dp.
    const rect = fitContain({ width: 1920, height: 1080 }, slide);
    expect(rect.width).toBeCloseTo(13.333, 3);
    expect(rect.height).toBeCloseTo(7.5, 3);
    expect(rect.x).toBeCloseTo(0, 3);
    expect(rect.y).toBeCloseTo(0, 3);
  });

  it("letterboxes a narrower frame without distorting it", () => {
    const rect = fitContain({ width: 1000, height: 1000 }, slide);
    expect(rect.width).toBeCloseTo(7.5, 5);
    expect(rect.height).toBeCloseTo(7.5, 5);
    expect(rect.y).toBeCloseTo(0, 5);
    expect(rect.x).toBeCloseTo((13.333 - 7.5) / 2, 5);
  });

  it("pillarboxes a wider frame without distorting it", () => {
    const rect = fitContain({ width: 2000, height: 500 }, slide);
    expect(rect.width).toBeCloseTo(13.333, 5);
    expect(rect.height).toBeCloseTo(13.333 / 4, 5);
    expect(rect.x).toBeCloseTo(0, 5);
    expect(rect.y).toBeCloseTo((7.5 - 13.333 / 4) / 2, 5);
  });

  it("falls back to the full slide for a degenerate canvas", () => {
    expect(fitContain({ width: 0, height: 10 }, slide)).toEqual({ x: 0, y: 0, ...slide });
  });
});
