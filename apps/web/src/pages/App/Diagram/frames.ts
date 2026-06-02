/**
 * Presentation slides are Excalidraw *frame* elements. This module turns a raw
 * scene element list into the ordered list of frames that drives both
 * presentation mode (camera steps) and PDF export (one page per frame).
 *
 * Ordering is reading order: top-to-bottom, then left-to-right within a row.
 * We bucket frames into rows first (rather than a single `(y, x)` comparator)
 * so the sort stays a consistent total order even when frames in a row have
 * slightly different top edges.
 */

export interface FrameLike {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function orderFrames<T extends FrameLike>(elements: readonly T[]): T[] {
  const frames = elements.filter((el) => el.type === "frame");
  if (frames.length === 0) return [];

  // Top-to-bottom first so rows form in vertical order.
  const byTop = [...frames].sort((a, b) => a.y - b.y);

  const rows: T[][] = [];
  for (const frame of byTop) {
    const row = rows[rows.length - 1];
    if (row) {
      const rowTop = row[0].y;
      // A frame joins the current row if its top is within half the smallest
      // height in play — i.e. it visually sits beside the row, not below it.
      const tolerance = Math.min(...row.map((r) => r.height), frame.height) / 2;
      if (frame.y - rowTop <= tolerance) {
        row.push(frame);
        continue;
      }
    }
    rows.push([frame]);
  }

  // Left-to-right within each row.
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}
