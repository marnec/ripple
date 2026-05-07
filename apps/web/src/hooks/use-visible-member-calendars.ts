import { useCallback, useSyncExternalStore } from "react";

import type { Id } from "@convex/_generated/dataModel";

// Per-workspace, per-device persistence of which workspace members'
// calendars the viewer is overlaying as background "busy" blocks on the
// dashboard calendar. localStorage matches the pattern used by
// use-acknowledged-channels.ts (channel-seen state, also per-workspace) —
// the value is small, the user owns it, and it never has to round-trip to
// the server. Storage shape: JSON-serialised `Id<"users">[]`.
const STORAGE_PREFIX = "calendar:visible-members:";

function storageKey(workspaceId: Id<"workspaces">) {
  return `${STORAGE_PREFIX}${workspaceId}`;
}

function readList(workspaceId: Id<"workspaces">): Id<"users">[] {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive — older corrupted blobs or hand-edits could yield non-strings.
    return parsed.filter((x): x is Id<"users"> => typeof x === "string");
  } catch {
    return [];
  }
}

function writeList(workspaceId: Id<"workspaces">, list: Id<"users">[]) {
  const key = storageKey(workspaceId);
  const value = JSON.stringify(list);
  const oldValue = localStorage.getItem(key);
  if (value === oldValue) return;
  localStorage.setItem(key, value);
  // StorageEvent only fires cross-tab natively; dispatch manually so
  // same-tab `useSyncExternalStore` subscribers (e.g. a second mount of
  // this hook in a sibling component) re-read.
  window.dispatchEvent(
    new StorageEvent("storage", { key, newValue: value, oldValue }),
  );
}

/**
 * Reactive accessor for the "which member calendars am I overlaying?"
 * preference, scoped to the given workspace. Returns the current list and
 * a setter mirroring `useState`. Empty list = no overlay.
 *
 * The list isn't validated against the live workspace member set here —
 * stale ids (member removed, etc.) are filtered downstream by the caller
 * (the combobox renders only members that exist; the Convex query is the
 * authoritative gate against cross-workspace probing).
 */
export function useVisibleMemberCalendars(
  workspaceId: Id<"workspaces">,
): readonly [Id<"users">[], (next: Id<"users">[]) => void] {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const handler = (e: StorageEvent) => {
        if (e.key === storageKey(workspaceId)) onStoreChange();
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
    [workspaceId],
  );
  const getSnapshot = useCallback(
    () => localStorage.getItem(storageKey(workspaceId)),
    [workspaceId],
  );
  // SSR/Node fallback — the calendar is client-only but the hook may be
  // imported from a code path Vite tree-shakes through SSR analysis.
  const getServerSnapshot = useCallback(() => null, []);

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Parse on every render — JSON.parse on a tiny array is O(n) and
  // useSyncExternalStore already gates re-renders on the raw string
  // changing. Memoising would mean another ref to invalidate by hand.
  const list: Id<"users">[] = (() => {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((x): x is Id<"users"> => typeof x === "string");
    } catch {
      return [];
    }
  })();

  const setList = useCallback(
    (next: Id<"users">[]) => writeList(workspaceId, next),
    [workspaceId],
  );

  return [list, setList] as const;
}

// Exported for the rare case a non-React callsite needs to read the
// current value (e.g. an analytics hook). Read-only — writes go through
// the React setter so subscribers fire.
export function readVisibleMemberCalendars(
  workspaceId: Id<"workspaces">,
): Id<"users">[] {
  return readList(workspaceId);
}
