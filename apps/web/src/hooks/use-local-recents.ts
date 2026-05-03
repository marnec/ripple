import { useSyncExternalStore, useCallback } from "react";
import type { BrowsableResourceType } from "@ripple/shared/types/resources";

export type { BrowsableResourceType as ResourceType } from "@ripple/shared/types/resources";

export interface RecentItem {
  resourceType: BrowsableResourceType;
  resourceId: string;
  resourceName: string;
  visitedAt: number;
}

const STORAGE_PREFIX = "recents:";
const MAX_ITEMS = 20; // store more than we display so we have headroom

function getStorageKey(workspaceId: string) {
  return `${STORAGE_PREFIX}${workspaceId}`;
}

function readRecents(workspaceId: string): RecentItem[] {
  try {
    const raw = localStorage.getItem(getStorageKey(workspaceId));
    if (!raw) return [];
    return JSON.parse(raw) as RecentItem[];
  } catch {
    return [];
  }
}

function writeRecents(workspaceId: string, items: RecentItem[]) {
  try {
    localStorage.setItem(getStorageKey(workspaceId), JSON.stringify(items));
  } catch {
    // quota exceeded — silently ignore
  }
}

// Simple pub/sub so useSyncExternalStore re-renders on writes
const listeners = new Set<() => void>();
function notify() {
  for (const fn of listeners) fn();
}

/** Record a visit — updates localStorage and notifies subscribers. */
export function recordLocalVisit(
  workspaceId: string,
  resourceType: BrowsableResourceType,
  resourceId: string,
  resourceName: string,
) {
  const items = readRecents(workspaceId);
  // Remove existing entry for this resource (upsert)
  const filtered = items.filter((r) => r.resourceId !== resourceId);
  // Prepend new entry
  filtered.unshift({
    resourceType,
    resourceId,
    resourceName,
    visitedAt: Date.now(),
  });
  // Trim to max
  writeRecents(workspaceId, filtered.slice(0, MAX_ITEMS));
  notify();
}

/** React hook — returns the N most recent items for a workspace. */
export function useLocalRecents(workspaceId: string | undefined, limit: number = 8): RecentItem[] {
  const subscribe = useCallback((cb: () => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);

  const getSnapshot = useCallback(() => {
    if (!workspaceId) return "[]";
    return localStorage.getItem(getStorageKey(workspaceId)) ?? "[]";
  }, [workspaceId]);

  const raw = useSyncExternalStore(subscribe, getSnapshot);

  try {
    const items = JSON.parse(raw) as RecentItem[];
    return items.slice(0, limit);
  } catch {
    return [];
  }
}
