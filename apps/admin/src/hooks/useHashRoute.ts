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
