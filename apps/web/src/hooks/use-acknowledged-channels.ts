import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ConversationSection } from "@/lib/conversation-section";

const STORAGE_PREFIX = "channels:known:";

/** Ordered list of [id, name] tuples — order matches last-seen query order */
type KnownList = [string, string][];

/**
 * One list per workspace *per sidebar section*. Channels and direct messages
 * are disjoint sets rendered by two independent headers, so a shared key made
 * a new conversation bump the Channels header's "+1" badge and a closed one
 * render as a struck-through `#` ghost in the channel list. The hook
 * auto-acknowledges everything when a key holds nothing, so splitting the key
 * needs no migration — the first render after this ships simply adopts what is
 * on screen.
 */
function getStorageKey(workspaceId: string, section: ConversationSection) {
  return `${STORAGE_PREFIX}${workspaceId}:${section}`;
}

function readKnownList(workspaceId: string, section: ConversationSection): KnownList {
  try {
    const raw = localStorage.getItem(getStorageKey(workspaceId, section));
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      // Migration: old format was string[] or Record<string, string>
      if (Array.isArray(parsed)) {
        if (parsed.length > 0 && Array.isArray(parsed[0])) {
          return parsed as KnownList;
        }
        // Old string[] format
        return (parsed as string[]).map((id) => [id, ""] as [string, string]);
      }
      if (typeof parsed === "object" && parsed !== null) {
        // Old Record<string, string> format
        return Object.entries(parsed as Record<string, string>);
      }
    }
  } catch {
    // ignore malformed data
  }
  return [];
}

function writeKnownList(workspaceId: string, section: ConversationSection, list: KnownList) {
  const key = getStorageKey(workspaceId, section);
  const value = JSON.stringify(list);
  const oldValue = localStorage.getItem(key);
  localStorage.setItem(key, value);
  // StorageEvent only fires cross-tab by default; dispatch manually
  // so same-tab useSyncExternalStore subscribers pick up the change.
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, oldValue }));
}

export interface ChannelEntry {
  id: string;
  name: string;
}

/**
 * Tracks which channels a user has "seen" in their sidebar via localStorage.
 * Stores an ordered [id, name][] so removed channels can be displayed as
 * ghost items in their original position.
 *
 * Channels not in the known list are treated as new and deferred from the list
 * to prevent layout shift from real-time channel creation by other users.
 *
 * First load (no localStorage entry): all channels are auto-acknowledged.
 *
 * Call `autoAcknowledgeNext()` before a user-initiated action (create/delete)
 * so the resulting query update is immediately reflected without badges.
 */
/**
 * Remove a channel from the known list so it won't appear as a ghost item.
 * Call this from the acting user's deletion flow before navigating away.
 */
export function removeFromKnownChannels(workspaceId: string, channelId: string) {
  // Both sections: a channel id and a conversation id are drawn from the same
  // table and can never collide, so the caller — a delete, a leave, a dismissal
  // — does not have to know which list it is in.
  for (const section of ["channels", "dms"] as const) {
    const current = readKnownList(workspaceId, section);
    const updated = current.filter(([id]) => id !== channelId);
    if (updated.length !== current.length) writeKnownList(workspaceId, section, updated);
  }
}

export function useAcknowledgedChannels(
  workspaceId: string,
  section: ConversationSection,
  channels: ChannelEntry[] | undefined,
  isVisible: boolean,
) {
  const initializedRef = useRef<string | null>(null);
  const autoAckRef = useRef(false);
  const prevChannelsRef = useRef<ChannelEntry[] | undefined>(undefined);
  const prevVisibleRef = useRef(false);

  // Subscribe to localStorage changes (cross-tab sync)
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const handler = (e: StorageEvent) => {
        if (e.key === getStorageKey(workspaceId, section)) onStoreChange();
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
    [workspaceId, section],
  );

  const getSnapshot = useCallback(
    () => localStorage.getItem(getStorageKey(workspaceId, section)),
    [workspaceId, section],
  );

  const rawSnapshot = useSyncExternalStore(subscribe, getSnapshot);

  const knownList = useMemo((): KnownList => {
    if (rawSnapshot) {
      try {
        const parsed: unknown = JSON.parse(rawSnapshot);
        if (Array.isArray(parsed)) {
          if (parsed.length > 0 && Array.isArray(parsed[0])) {
            return parsed as KnownList;
          }
          return (parsed as string[]).map((id) => [id, ""] as [string, string]);
        }
        if (typeof parsed === "object" && parsed !== null) {
          return Object.entries(parsed as Record<string, string>);
        }
      } catch {
        return [];
      }
    }
    return [];
  }, [rawSnapshot]);

  const knownIdSet = useMemo(() => new Set(knownList.map(([id]) => id)), [knownList]);

  // Build the live list from current channels
  const liveList = useMemo(
    (): KnownList => channels?.map((c) => [c.id, c.name] as [string, string]) ?? [],
    [channels],
  );

  // Auto-acknowledge on any not-visible → visible transition (page load, reload,
  // section expand, mobile sidebar open). Also handles first-load (no localStorage).
  // The point of acknowledgment is UI stability while the user is looking at the
  // list — if they weren't looking, there's no reference to diff against.
  // useLayoutEffect so the localStorage write (+ useSyncExternalStore re-render)
  // happens before the browser paints — no pill flash on transitions.
  useLayoutEffect(() => {
    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = isVisible;

    if (!isVisible || !channels) return;

    // First load ever (no localStorage): seed the known list
    if (initializedRef.current !== workspaceId && !rawSnapshot) {
      initializedRef.current = workspaceId;
      writeKnownList(workspaceId, section, liveList);
      return;
    }

    // Transition from not-visible → visible: auto-acknowledge
    if (!wasVisible) {
      writeKnownList(workspaceId, section, liveList);
    }
  }, [isVisible, channels, workspaceId, section, rawSnapshot, liveList]);

  // Auto-acknowledge when channels change after a user-initiated action.
  // useLayoutEffect so the write happens before paint — no pill flash.
  useLayoutEffect(() => {
    if (autoAckRef.current && channels && channels !== prevChannelsRef.current) {
      autoAckRef.current = false;
      writeKnownList(workspaceId, section, liveList);
    }
    prevChannelsRef.current = channels;
  }, [channels, workspaceId, section, liveList]);

  /**
   * Build a merged display list that preserves the known order.
   * - Known entries still live → rendered normally
   * - Known entries no longer live → ghost items (removed by someone else)
   * - Live entries not in known → new (deferred, shown as +N badge)
   */
  const { displayList, newCount } = useMemo(() => {
    if (!channels)
      return { displayList: [] as { id: string; name: string; removed: boolean }[], newCount: 0 };

    // Not visible: skip pill computation entirely
    if (!isVisible) {
      return {
        displayList: channels.map((c) => ({ id: c.id, name: c.name, removed: false })),
        newCount: 0,
      };
    }

    // First load (no localStorage yet): show all as-is
    if (knownList.length === 0 && !rawSnapshot) {
      return {
        displayList: channels.map((c) => ({ id: c.id, name: c.name, removed: false })),
        newCount: 0,
      };
    }

    const liveMap = new Map(channels.map((c) => [c.id, c.name]));
    const display: { id: string; name: string; removed: boolean }[] = [];

    // Walk the known list in order — this preserves original positions
    for (const [id, name] of knownList) {
      if (liveMap.has(id)) {
        display.push({ id, name: liveMap.get(id)!, removed: false });
      } else {
        display.push({ id, name, removed: true });
      }
    }

    // Count new channels (live but not known)
    let fresh = 0;
    for (const c of channels) {
      if (!knownIdSet.has(c.id)) fresh++;
    }

    return { displayList: display, newCount: fresh };
  }, [channels, knownList, knownIdSet, rawSnapshot, isVisible]);

  const removedCount = useMemo(
    () => displayList.filter((d) => d.removed).length,
    [displayList],
  );

  /** Sync known list to match the current live channel list */
  const acknowledgeAll = useCallback(() => {
    if (!channels) return;
    writeKnownList(workspaceId, section, liveList);
  }, [workspaceId, section, channels, liveList]);

  const acknowledgeOne = useCallback(
    (channelId: string, channelName: string) => {
      const current = readKnownList(workspaceId, section);
      // Add at end if not already present
      if (!current.some(([id]) => id === channelId)) {
        current.push([channelId, channelName]);
      }
      writeKnownList(workspaceId, section, current);
    },
    [workspaceId, section],
  );

  /**
   * Call before a user-initiated action that will change the channel list
   * (create or delete). The next time channels updates, the hook will
   * auto-acknowledge everything so the change appears instantly.
   */
  const autoAcknowledgeNext = useCallback(() => {
    autoAckRef.current = true;
  }, []);

  return {
    displayList,
    newCount,
    removedCount,
    acknowledgeAll,
    acknowledgeOne,
    autoAcknowledgeNext,
  };
}
