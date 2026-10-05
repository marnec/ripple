import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query currently matches. For layout that has to choose
 * between *different trees* — where hiding one with a `lg:` class would still
 * mount it (and its BlockNote editor) twice.
 */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Tailwind's `lg` breakpoint (64rem). */
export const LG_MEDIA_QUERY = "(min-width: 64rem)";
