import { flushSync } from "react-dom";

/**
 * The mobile sidebar backdrop only exists in the DOM when the sidebar is
 * expanded on a mobile viewport. View transitions promote named elements
 * to a top-layer overlay that renders above the sidebar, causing a flash.
 */
export function isMobileSidebarOpen() {
  return !!document.querySelector('[data-slot="sidebar-backdrop"]');
}

/**
 * Wraps a state update in a View Transition, animating DOM changes
 * (reordering, appearing, disappearing) automatically.
 * Falls back to a plain synchronous call when the API is unsupported
 * or when the mobile sidebar is open (to avoid z-order glitches).
 */
export const VIEW_TRANSITIONS_DISABLED = false;

export function startViewTransition(callback: () => void) {
  if (VIEW_TRANSITIONS_DISABLED || !document.startViewTransition || isMobileSidebarOpen()) {
    callback();
    return;
  }
  document.startViewTransition(() => {
    flushSync(callback);
  });
}
