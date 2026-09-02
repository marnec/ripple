import { useSyncExternalStore } from "react";

/* A dependency-free hash router. We deliberately avoid react-router here: the
   admin app has a handful of flat routes, and hash routing needs no server
   rewrite config on the static Cloudflare deploy. Routes look like
   "#/users" or "#/workspaces/<id>". */

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

function getSnapshot() {
  return window.location.hash.slice(1) || "/";
}

export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Path segments without empty parts, e.g. "/workspaces/abc" → ["workspaces","abc"]. */
export function useRouteSegments(): string[] {
  const path = useHashRoute();
  return path.split("/").filter(Boolean);
}

export function navigate(to: string) {
  window.location.hash = to;
}

/**
 * The tab a `#/<section>/<id>/<sub>` URL selects.
 *
 * Detail pages put their tab in the route so a tab is linkable and survives a
 * reload; a missing or unrecognised segment falls back to the first tab, which
 * is what makes the bare `#/<section>/<id>` a valid URL.
 */
export function resolveTab<T extends string>(sub: string | undefined, tabs: readonly T[]): T {
  return tabs.includes(sub as T) ? (sub as T) : tabs[0];
}
