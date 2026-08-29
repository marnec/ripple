/**
 * Slide geometry for the PPTX exporter.
 *
 * PPTX differs from PDF in one way that shapes this module: a deck has exactly
 * *one* slide size, while `exportDiagramPdf` gives every page its own geometry.
 * So the deck picks a single size up front and every frame is contain-fitted
 * into it — pure functions here, rasterisation in `diagram.ts`.
 */

/** PowerPoint's own widescreen default (`LAYOUT_WIDE`), in inches. */
const WIDE_W = 13.333;
const WIDE_H = 7.5;

/** PowerPoint refuses slides outside this range (inches). */
const MIN_IN = 1;
const MAX_IN = 56;

export interface SlideSize {
  width: number;
  height: number;
}

export interface SlideRect extends SlideSize {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Deck size (inches) for a diagram whose first frame rasterises to `px`.
 *
 * Landscape frames keep PowerPoint's 13.333" width and portrait frames its 7.5"
 * height, so the common 16:9 presentation lands exactly on `LAYOUT_WIDE` rather
 * than a near-miss custom size.
 */
export function deckSize(px: SlideSize): SlideSize {
  const aspect = px.width > 0 && px.height > 0 ? px.width / px.height : WIDE_W / WIDE_H;
  const raw =
    aspect >= 1
      ? { width: WIDE_W, height: WIDE_W / aspect }
      : { width: WIDE_H * aspect, height: WIDE_H };
  return {
    width: clamp(raw.width, MIN_IN, MAX_IN),
    height: clamp(raw.height, MIN_IN, MAX_IN),
  };
}

/**
 * Centre `px` inside `slide` at its natural aspect ratio, never upscaling past
 * the slide. Frames that don't match the deck's shape letterbox rather than
 * stretch — a diagram with mixed frame sizes stays undistorted.
 */
export function fitContain(px: SlideSize, slide: SlideSize): SlideRect {
  if (px.width <= 0 || px.height <= 0) return { x: 0, y: 0, ...slide };
  const scale = Math.min(slide.width / px.width, slide.height / px.height);
  const width = px.width * scale;
  const height = px.height * scale;
  return {
    x: (slide.width - width) / 2,
    y: (slide.height - height) / 2,
    width,
    height,
  };
}
