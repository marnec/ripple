import { cn } from "@/lib/utils";
import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type ValueAnimationTransition,
} from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";

const MAX_TRANSLATE = 80; // px the row slides open
const THRESHOLD = 60; // px drag needed to snap open/closed

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
  const reduceMotion = useReducedMotion();

  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };

  const x = useMotionValue(0);
  // Exposed as CSS var so the action panel can size itself with it
  const xPx = useMotionTemplate`${x}px`;
  const fadeOpacity = useTransform(x, [0, -24], [0, 1]);

  const snapTransition: ValueAnimationTransition = reduceMotion
    ? { type: "tween", duration: 0 }
    : { type: "inertia", bounceStiffness: 300, bounceDamping: 40 };

  // Sync controlled open state → animate position.
  // Legitimate Effect: synchronising React state with the framer-motion animation system.
  useEffect(() => {
    animate(x, isOpen ? -MAX_TRANSLATE : 0, {
      ...(reduceMotion
        ? { type: "tween", duration: 0 }
        : { type: "spring", stiffness: 400, damping: 35 }),
    });
  }, [isOpen, x, reduceMotion]);

  if (!enabled) return <>{children}</>;

  return (
    <div
      className={cn("relative overflow-hidden rounded-lg", className)}
      style={style}
    >
      {/* Fade gradient on the left edge, fixed in place while content slides away */}
      <motion.div
        style={{ opacity: fadeOpacity }}
        className="absolute inset-y-0 left-0 w-16 bg-linear-to-l from-transparent to-card pointer-events-none z-20"
      />

      <motion.div
        drag="x"
        dragConstraints={{ right: 0 }}
        dragElastic={{ left: 0.1, right: 0 }}
        // touch-action: pan-y lets the browser handle vertical scroll natively
        // while framer-motion intercepts horizontal drag.
        style={{ x, "--x": xPx, touchAction: "pan-y" } as unknown as React.CSSProperties}
        className="relative z-10 bg-card"
        onDragStart={() => onSwipeStart?.()}
        onDragEnd={() => {
          const cur = x.get();
          if (isOpen) {
            if (cur > -THRESHOLD) {
              animate(x, 0, { ...snapTransition, min: 0, max: 0 });
              setOpen(false);
            } else {
              animate(x, -MAX_TRANSLATE, { ...snapTransition, min: -MAX_TRANSLATE, max: -MAX_TRANSLATE });
            }
          } else {
            if (cur < -THRESHOLD) {
              animate(x, -MAX_TRANSLATE, { ...snapTransition, min: -MAX_TRANSLATE, max: -MAX_TRANSLATE });
              setOpen(true);
            } else {
              animate(x, 0, { ...snapTransition, min: 0, max: 0 });
            }
          }
        }}
        onClick={() => {
          if (isOpen) setOpen(false);
        }}
      >
        {children}

        {/* Action panel: sits just off the right edge, grows with drag via --x.
            stopPropagation prevents the motion.div onClick from closing when
            the user taps an action button. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "100%",
            height: "100%",
            width: `max(${MAX_TRANSLATE}px, calc(-1 * var(--x)))`,
          }}
          className="flex items-stretch"
          onClick={(e) => e.stopPropagation()}
        >
          {action}
        </div>
      </motion.div>
    </div>
  );
}
