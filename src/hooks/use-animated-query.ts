import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/**
 * Buffers a Convex `useQuery` result and applies changes inside a
 * View Transition so that elements with `view-transition-name` animate
 * automatically — even when the update comes from another user.
 *
 * @param shouldAbsorb — When provided and returns `true`, the data change
 *   is silently absorbed: `rendered` is NOT updated, so no re-render and
 *   no animation occurs. Useful for suppressing position-only reorders
 *   when a sort override makes them invisible.
 *   When the callback later stops returning `true` (e.g. sorting is
 *   turned off), any accumulated difference is synced immediately.
 *
 * @param suppressRef — When `.current` is `true`, data changes are applied
 *   synchronously during render (no animation, no intermediate frame).
 *   Used to bypass view transitions during DnD operations so dnd-kit
 *   never sees a stale layout.
 */
export function useAnimatedQuery<T>(
  liveData: T,
  shouldAbsorb?: (prev: NonNullable<T>, next: NonNullable<T>) => boolean,
  suppressRef?: React.RefObject<boolean>,
): T {
  const [rendered, setRendered] = useState(liveData);
  const transitioning = useRef(false);
  const absorbed = useRef(false);
  const absorbRef = useRef(shouldAbsorb);
  absorbRef.current = shouldAbsorb;

  // ── Render-time fast paths ────────────────────────────────────────
  // React supports setState during render for derived-state patterns.
  // The component re-renders immediately with the new value *before*
  // the browser paints, so no intermediate frame is ever visible.

  if (!Object.is(liveData, rendered) && liveData != null && rendered != null) {
    // Suppressed (DnD active) — sync instantly so dnd-kit / SortableContext
    // always sees the correct item order. No intermediate layout change.
    if (suppressRef?.current) {
      setRendered(liveData);
    }
    // Previously absorbed data becomes relevant (e.g. sorting turned off)
    else if (absorbed.current) {
      const stillAbsorbed = absorbRef.current?.(
        rendered as NonNullable<T>,
        liveData as NonNullable<T>,
      );
      if (!stillAbsorbed) {
        absorbed.current = false;
        setRendered(liveData);
      }
    }
  }

  // ── Effect: animated & absorbed paths ─────────────────────────────
  useEffect(() => {
    // Already in sync
    if (Object.is(liveData, rendered)) {
      absorbed.current = false;
      return;
    }

    // Don't animate the initial data load
    if (rendered == null) {
      setRendered(liveData);
      return;
    }

    // Buffer old data while query is loading (e.g. Convex re-subscribing
    // after search param change). Keep showing stale results so persisting
    // elements stay in the DOM and can animate to their new positions
    // once fresh data arrives.
    if (liveData == null) return;

    // Suppress handled during render — nothing to do here
    if (suppressRef?.current) return;

    // Caller says this change is not visually meaningful — absorb entirely
    if (
      liveData != null &&
      absorbRef.current?.(rendered as NonNullable<T>, liveData as NonNullable<T>)
    ) {
      absorbed.current = true;
      return;
    }

    absorbed.current = false;

    // If mid-transition or API unsupported, apply directly
    if (transitioning.current || !document.startViewTransition) {
      setRendered(liveData);
      return;
    }

    transitioning.current = true;
    document.startViewTransition(() => {
      flushSync(() => setRendered(liveData));
    }).finished.finally(() => {
      transitioning.current = false;
    });
  }, [liveData, rendered]);

  return rendered;
}

/**
 * Returns `true` when the only difference between two task arrays is the
 * `position` field (and consequently the array order, since the server
 * sorts by position). Matches tasks by `_id` across both arrays so that
 * a reorder doesn't look like a structural change.
 */
export function isPositionOnlyChange(
  prev: Array<Record<string, unknown>>,
  next: Array<Record<string, unknown>>,
): boolean {
  if (prev.length !== next.length) return false;

  const prevById = new Map<unknown, Record<string, unknown>>();
  for (const t of prev) prevById.set(t._id, t);

  for (const n of next) {
    const p = prevById.get(n._id);
    if (!p) return false; // task added or ID mismatch
    for (const key of Object.keys(n)) {
      if (key === "position") continue;
      if (Object.is(p[key], n[key])) continue;
      // Enriched objects (status, assignee) get new references on every
      // Convex query re-run even when content is identical — deep compare.
      if (
        typeof n[key] === "object" && n[key] !== null &&
        typeof p[key] === "object" && p[key] !== null &&
        JSON.stringify(p[key]) === JSON.stringify(n[key])
      ) continue;
      return false;
    }
  }
  return true;
}
