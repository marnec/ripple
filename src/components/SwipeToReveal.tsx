import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const THRESHOLD = 60; // px to swipe before action snaps open
const MAX_TRANSLATE = 80; // max px the row can slide

type SwipeToRevealProps = {
  /** The action element revealed behind the row (e.g. a delete button). */
  action: ReactNode;
  /** Whether swipe is enabled. When false, renders children only. */
  enabled?: boolean;
  /** Called when swiping starts — use to close other open rows. */
  onSwipeStart?: () => void;
  /** Controlled open state. */
  open?: boolean;
  /** Called when open state changes. */
  onOpenChange?: (open: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
};

export function SwipeToReveal({
  action,
  enabled = true,
  onSwipeStart,
  open: controlledOpen,
  onOpenChange,
  className,
  style,
  children,
}: SwipeToRevealProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (v: boolean) => {
      setInternalOpen(v);
      onOpenChange?.(v);
    },
    [onOpenChange],
  );

  const rowRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const directionLocked = useRef<"horizontal" | "vertical" | null>(null);

  // Keep latest values in refs so native listeners always see current state
  const isOpenRef = useRef(isOpen);
  const onSwipeStartRef = useRef(onSwipeStart);
  const setOpenRef = useRef(setOpen);
  useEffect(() => {
    isOpenRef.current = isOpen;
    onSwipeStartRef.current = onSwipeStart;
    setOpenRef.current = setOpen;
  });

  // Sync controlled open → translate position
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    el.style.transition = "translate 0.25s cubic-bezier(.2,.8,.4,1)";
    el.style.translate = isOpen ? `${-MAX_TRANSLATE}px 0` : "0 0";
  }, [isOpen]);

  // Touch listeners on the slidable row element.
  // `touch-action: pan-y` on the outer wrapper tells the browser to handle
  // vertical scroll natively, so horizontal touchmove events stay cancelable.
  // touchmove is non-passive so we can preventDefault on horizontal swipes;
  // the cancelable guard handles edge cases (fling momentum, late direction
  // changes) to avoid Chrome's intervention warnings.
  useEffect(() => {
    const el = rowRef.current;
    if (!el || !enabled) return;

    const setTranslate = (px: number, animate: boolean) => {
      el.style.transition = animate ? "translate 0.25s cubic-bezier(.2,.8,.4,1)" : "none";
      el.style.translate = `${px}px 0`;
    };

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      dragging.current = true;
      directionLocked.current = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX.current;
      const dy = touch.clientY - startY.current;

      // Lock direction after 10px of movement
      if (!directionLocked.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        directionLocked.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
        if (directionLocked.current === "horizontal") {
          onSwipeStartRef.current?.();
        }
      }

      if (directionLocked.current !== "horizontal") return;

      // Prevent any residual scroll during horizontal swipe.
      // With touch-action:pan-y on the wrapper, horizontal events are
      // normally cancelable. Guard for edge cases (fling, late lock).
      if (e.cancelable) e.preventDefault();

      const base = isOpenRef.current ? -MAX_TRANSLATE : 0;
      const raw = base + dx;
      const clamped = Math.max(-MAX_TRANSLATE - 20, Math.min(0, raw));
      // Rubber band past the limit
      const px = clamped < -MAX_TRANSLATE
        ? -MAX_TRANSLATE + (clamped + MAX_TRANSLATE) * 0.3
        : clamped;

      setTranslate(px, false);
    };

    const onTouchEnd = () => {
      if (!dragging.current) return;
      dragging.current = false;

      if (directionLocked.current !== "horizontal") return;

      const style = getComputedStyle(el);
      const match = style.translate.match(/^(-?[\d.]+)px/);
      const currentPx = match ? parseFloat(match[1]) : 0;

      if (isOpenRef.current) {
        if (currentPx > -THRESHOLD) {
          setTranslate(0, true);
          setOpenRef.current(false);
        } else {
          setTranslate(-MAX_TRANSLATE, true);
        }
      } else {
        if (currentPx < -THRESHOLD) {
          setTranslate(-MAX_TRANSLATE, true);
          setOpenRef.current(true);
        } else {
          setTranslate(0, true);
        }
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled]);

  if (!enabled) {
    return <>{children}</>;
  }

  // Close on tap when open
  const handleClick = () => {
    if (isOpen) {
      setOpen(false);
    }
  };

  return (
    <div
      className={cn("relative overflow-hidden rounded-lg", className)}
      style={{ touchAction: "pan-y", ...style }}
    >
      {/* Action behind the row, anchored to the right */}
      <div className="absolute inset-y-0 right-0 flex items-stretch" style={{ width: MAX_TRANSLATE }}>
        {action}
      </div>

      {/* Slidable foreground row */}
      <div
        ref={rowRef}
        onClick={handleClick}
        className="relative z-10 bg-card"
      >
        {children}
      </div>
    </div>
  );
}
