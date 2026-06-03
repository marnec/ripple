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

export interface SceneElementLike extends FrameLike {
  id: string;
  frameId?: string | null;
}

/**
 * The elements to render when showing a single frame in isolation (doc embeds,
 * picker thumbnails): the frame element plus its content.
 *
 * Content is the frame's true members (`frameId`) when it has any — neighbouring
 * clusters that merely straddle the frame edge but belong to no frame are
 * excluded, so we don't render half of an unrelated group as empty boxes. Only
 * when a frame has no members at all (a diagram where nothing was assigned) do
 * we fall back to elements overlapping the frame's bounding box.
 *
 * Callers export these WITHOUT `exportingFrame` so the result keeps its natural
 * bounds and is NOT clipped to the frame rectangle — matching how the editor
 * shows a frame (members that extend past the edge stay fully visible, rather
 * than being cut off the way `exportingFrame`'s clip-to-frame did).
 */
export function frameViewElements<T extends SceneElementLike>(
  elements: readonly T[],
  frameId: string,
): T[] {
  const frame = elements.find((el) => el.type === "frame" && el.id === frameId);
  if (!frame) return [];

  const members = elements.filter(
    (el) => el.type !== "frame" && el.frameId === frameId,
  );
  if (members.length > 0) return [frame, ...members];

  // Fallback: no membership recorded — take elements overlapping the frame.
  const left = frame.x;
  const right = frame.x + frame.width;
  const top = frame.y;
  const bottom = frame.y + frame.height;
  const overlapping = elements.filter(
    (el) =>
      el.type !== "frame" &&
      el.x < right &&
      el.x + el.width > left &&
      el.y < bottom &&
      el.y + el.height > top,
  );
  return overlapping.length > 0 ? [frame, ...overlapping] : [];
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
