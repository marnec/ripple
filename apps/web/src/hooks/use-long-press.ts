import { useRef } from "react";

const DEFAULT_DELAY_MS = 450;
// A finger drifts a few px even when held still; past this it is a scroll or
// a swipe, not a press.
const MOVE_TOLERANCE_PX = 10;

type Press = {
  timer: ReturnType<typeof setTimeout>;
  x: number;
  y: number;
  fired: boolean;
};

/**
 * Touch long-press over a list of rows. One instance serves the whole list —
 * call the returned binder per row with that row's key and spread the result
 * onto a wrapper that stays mounted for the row's lifetime.
 *
 * Touch only: a mouse has hover and checkboxes for this. The press cancels on
 * movement, and on `pointercancel`, which the browser sends when it takes the
 * gesture over for native scrolling. The click that ends a fired press is
 * swallowed in the capture phase so the row underneath doesn't also open.
 */
export function useLongPress<K>(onLongPress: (key: K) => void, delayMs = DEFAULT_DELAY_MS) {
  const press = useRef<Press | null>(null);

  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  return (key: K) => ({
    onPointerDown: (e: React.PointerEvent) => {
      // Also clears a stale `fired` from a press whose click never came.
      cancel();
      if (e.pointerType !== "touch") return;
      const current: Press = {
        x: e.clientX,
        y: e.clientY,
        fired: false,
        timer: setTimeout(() => {
          current.fired = true;
          navigator.vibrate?.(10);
          onLongPress(key);
        }, delayMs),
      };
      press.current = current;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const current = press.current;
      if (!current || current.fired) return;
      if (Math.hypot(e.clientX - current.x, e.clientY - current.y) > MOVE_TOLERANCE_PX) cancel();
    },
    // Stop the timer but keep `fired`: the click that follows still has to be
    // swallowed.
    onPointerUp: () => {
      if (press.current) clearTimeout(press.current.timer);
    },
    onPointerCancel: cancel,
    // Android raises the context menu on the same hold.
    onContextMenu: (e: React.MouseEvent) => {
      if (press.current) e.preventDefault();
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (press.current?.fired) {
        e.preventDefault();
        e.stopPropagation();
      }
      press.current = null;
    },
  });
}
