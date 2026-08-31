import { useEffect, useState } from "react";
import {
  loadEmbedPreview,
  readEmbedPreviewSync,
  saveEmbedPreview,
} from "@/lib/embed-preview-cache";

/**
 * What to render for one embed: the server's answer, or this device's copy of
 * it while the server is still answering.
 *
 * Unlike `useRoomCached`, a live `null` here does **not** clear the copy. The
 * rows these queries read — `spreadsheetCellRefs`, `documentBlockRefs` — are
 * themselves a cache of the referenced room, so a missing row means "nothing
 * has been projected yet", which is exactly the moment after an embed is
 * inserted and the only moment the stored copy is worth anything. Whether the
 * referenced *resource* still exists is a different question, asked of that
 * resource's own query, and every caller here asks it separately.
 */
export function useEmbedPreview<T>(
  key: string | null,
  live: T | null | undefined,
): T | undefined {
  const [cached, setCached] = useState<T | undefined>(() =>
    key ? readEmbedPreviewSync<T>(key) : undefined,
  );

  // A copy kept for one embed says nothing about the next. Reset while
  // rendering rather than in an effect, so the first render after the key
  // changes never shows the previous embed's content.
  const [cachedKey, setCachedKey] = useState(key);
  if (cachedKey !== key) {
    setCachedKey(key);
    setCached(key ? readEmbedPreviewSync<T>(key) : undefined);
  }

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void loadEmbedPreview<T>(key).then((stored) => {
      if (!cancelled && stored !== null) setCached(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (!key || live === undefined || live === null) return;
    saveEmbedPreview(key, live);
  }, [key, live]);

  return live ?? cached;
}
