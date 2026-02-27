import { flushSync } from "react-dom";

/**
 * Returns a function that wraps a state update in a View Transition,
 * animating DOM changes (reordering, appearing, disappearing) automatically.
 * Falls back to a plain synchronous call when the API is unsupported.
 */
export function startViewTransition(callback: () => void) {
  if (!document.startViewTransition) {
    callback();
    return;
  }
  document.startViewTransition(() => {
    flushSync(callback);
  });
}
