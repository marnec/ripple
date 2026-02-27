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
 */
export function useAnimatedQuery<T>(
  liveData: T,
  shouldAbsorb?: (prev: NonNullable<T>, next: NonNullable<T>) => boolean,
): T {
  const [rendered, setRendered] = useState(liveData);
  const transitioning = useRef(false);
  const absorbed = useRef(false);
  const absorbRef = useRef(shouldAbsorb);
  absorbRef.current = shouldAbsorb;

  // When the absorb condition stops holding (e.g. sorting turned off),
  // sync any divergence immediately. This is the "setState during render"
  // pattern React supports for derived state.
  if (absorbed.current && !Object.is(liveData, rendered)) {
    const stillAbsorbed =
      liveData != null &&
      rendered != null &&
      absorbRef.current?.(rendered as NonNullable<T>, liveData as NonNullable<T>);

    if (!stillAbsorbed) {
      absorbed.current = false;
      setRendered(liveData);
    }
  }

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
 * `position` field — i.e. a same-column vertical reorder that has no
 * visual effect when a sort override is active.
 */
export function isPositionOnlyChange(
  prev: Array<Record<string, unknown>>,
  next: Array<Record<string, unknown>>,
): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i];
    const n = next[i];
    // Different task in this slot → structural change
    if (p._id !== n._id) return false;
    // Check all keys (from new object) except position
    for (const key of Object.keys(n)) {
      if (key === "position") continue;
      if (!Object.is(p[key], n[key])) return false;
    }
  }
  return true;
}
