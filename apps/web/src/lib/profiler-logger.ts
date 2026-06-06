import type { ProfilerOnRenderCallback } from "react";

const SLOW_RENDER_MS = 4;

/**
 * Shared Profiler onRender callback.
 * Logs renders that take longer than SLOW_RENDER_MS or that are updates
 * (not initial mounts), helping identify unnecessary re-renders.
 */
export const onRenderCallback: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  _baseDuration,
  _startTime,
  _commitTime,
) => {
  // Off by default — opt in with VITE_PROFILER=1. Keeps the console clean
  // while leaving the instrumentation a flip away.
  if (import.meta.env.VITE_PROFILER !== "1") return;
  if (phase === "update" || actualDuration > SLOW_RENDER_MS) {
    console.log(
      `[Profiler] ${id} | ${phase} | ${actualDuration.toFixed(1)}ms`,
    );
  }
};
