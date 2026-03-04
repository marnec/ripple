import { useEffect, useRef } from "react";

/** A thin progress bar that animates from 100% → 0% width over `duration` ms. */
export function CountdownBar({ duration }: { duration: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.animate([{ width: "100%" }, { width: "0%" }], {
      duration,
      fill: "forwards",
      easing: "linear",
    });
  }, [duration]);

  return (
    <div className="mt-2 h-0.5 w-full rounded-full bg-destructive-foreground/20 overflow-hidden">
      <div
        ref={ref}
        className="h-full w-full rounded-full bg-destructive-foreground/70"
      />
    </div>
  );
}
