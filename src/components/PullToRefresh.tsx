import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const THRESHOLD = 80; // px to pull before triggering reload
const MAX_PULL = 120; // max visual pull distance
const RESISTANCE = 0.4; // rubber-band resistance factor

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [releasing, setReleasing] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);

  const handleReload = useCallback(() => {
    setReleasing(true);
    setTimeout(() => {
      window.location.reload();
    }, 300);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop > 0) return;
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy < 0) {
        pulling.current = false;
        setPullDistance(0);
        return;
      }
      const distance = Math.min(MAX_PULL, dy * RESISTANCE);
      setPullDistance(distance);
    };

    const onTouchEnd = () => {
      if (!pulling.current) return;
      pulling.current = false;
      if (pullDistance >= THRESHOLD) {
        handleReload();
      } else {
        setPullDistance(0);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [pullDistance, handleReload]);

  const progress = Math.min(1, pullDistance / THRESHOLD);
  const showIndicator = pullDistance > 10;

  return (
    <div ref={containerRef} className="relative h-full overflow-y-auto scrollbar-stable">
      {showIndicator && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center"
          style={{
            transform: `translateY(${pullDistance - 40}px)`,
            transition: releasing ? "transform 0.3s ease" : "none",
            opacity: progress,
          }}
        >
          <div className="rounded-full bg-muted p-2 shadow-md">
            <RefreshCw
              className="size-5 text-muted-foreground"
              style={{
                transform: `rotate(${progress * 360}deg)`,
                transition: releasing ? "none" : "transform 0.1s linear",
              }}
            />
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
