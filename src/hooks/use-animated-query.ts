import { useEffect, useEffectEvent, useRef, useState } from "react";
import type React from "react";
import { flushSync } from "react-dom";
import { isMobileSidebarOpen } from "./use-view-transition";

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
 * @param suppress — When `true`, data changes are applied synchronously
 *   during render (no animation, no intermediate frame). Used to bypass
 *   view transitions during DnD operations so dnd-kit never sees a stale
 *   layout, and while sheets/overlays are open to avoid z-order glitches.
 *
 * @param vtScopeRef — Optional ref to a container element. When provided,
 *   before starting a view transition any `.sidebar-item-vt` elements
 *   OUTSIDE this container have their `view-transition-name` temporarily
 *   set to `none` so they don't participate in the transition (which would
 *   reset their CSS `:hover` state and cause hover-only UI to flash).
 */
export function useAnimatedQuery<T>(
  liveData: T,
  shouldAbsorb?: (prev: NonNullable<T>, next: NonNullable<T>) => boolean,
  suppress?: boolean,
  vtScopeRef?: React.RefObject<HTMLElement | null>,
): T {
  const [rendered, setRendered] = useState(liveData);
  const transitioning = useRef(false);
  const absorbed = useRef(false);

  // Effect-events capture the latest prop values without requiring them
  // in the effect dependency array (eslint-plugin-react-hooks recognises
  // useEffectEvent and auto-excludes its return from deps).
  const checkAbsorb = useEffectEvent(
    (prev: NonNullable<T>, next: NonNullable<T>) =>
      shouldAbsorb?.(prev, next) ?? false,
  );
  const isSuppressed = useEffectEvent(() => suppress ?? false);
  const getVtScope = useEffectEvent(() => vtScopeRef?.current ?? null);

  // ── Render-time fast paths ────────────────────────────────────────
  // React supports setState during render for derived-state patterns.
  // The component re-renders immediately with the new value *before*
  // the browser paints, so no intermediate frame is ever visible.

  if (!Object.is(liveData, rendered) && liveData != null && rendered != null) {
    // Suppressed (DnD active / sheet open) — sync instantly so dnd-kit /
    // SortableContext always sees the correct item order.
    if (suppress) {
      setRendered(liveData);
    }
    // Previously absorbed data becomes relevant (e.g. sorting turned off).
    // `absorbed` is internal bookkeeping that cannot be state (would cause
    // a wasted render cycle); reading/writing during render is the only way
    // to implement synchronous derived-state reconciliation.
    /* eslint-disable react-hooks/refs */
    else if (absorbed.current) {
      const stillAbsorbed = shouldAbsorb?.(rendered, liveData);
      if (!stillAbsorbed) {
        absorbed.current = false;
        setRendered(liveData);
      }
    }
    /* eslint-enable react-hooks/refs */
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
    if (isSuppressed()) return;

    // Caller says this change is not visually meaningful — absorb entirely
    if (checkAbsorb(rendered, liveData)) {
      absorbed.current = true;
      return;
    }

    absorbed.current = false;

    // If mid-transition, API unsupported, or mobile sidebar open, apply directly
    if (transitioning.current || !document.startViewTransition || isMobileSidebarOpen()) {
      setRendered(liveData);
      return;
    }

    // Neutralize sidebar items outside our scope so they don't participate
    // in the transition (the snapshot/replace cycle resets CSS :hover).
    const frozen: Array<{ el: HTMLElement; name: string }> = [];
    const scope = getVtScope();
    if (scope) {
      document.querySelectorAll<HTMLElement>('.sidebar-item-vt').forEach(el => {
        if (!scope.contains(el)) {
          const name = el.style.viewTransitionName;
          if (name && name !== 'none') {
            frozen.push({ el, name });
            el.style.viewTransitionName = 'none';
          }
        }
      });
    }

    transitioning.current = true;
    void document.startViewTransition(() => {
      flushSync(() => setRendered(liveData));
    }).finished.finally(() => {
      transitioning.current = false;
      for (const { el, name } of frozen) {
        el.style.viewTransitionName = name;
      }
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
