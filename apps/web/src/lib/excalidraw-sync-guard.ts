/**
 * Containment for the Excalidraw ↔ Yjs sync layer.
 *
 * The `y-excalidraw` binding lives on two React-facing surfaces: the
 * `excalidrawAPI.onChange` subscriber, which Excalidraw dispatches from inside
 * its own render/commit, and the binding constructor, which we run inside an
 * effect. A throw on either surface escapes into React and unmounts the route —
 * so a bug in the *sync* system takes *local editing* down with it. That is
 * exactly what the `generateKeyBetween` crash did (see
 * `patches/y-excalidraw@2.0.12.patch`).
 *
 * Patching the library fixes one bug. This module fixes the class: nothing
 * thrown by the sync layer reaches React. Sync degrades, the canvas keeps
 * working, and the user is told their changes are local-only.
 *
 * Deliberately NOT covered: the binding's Yjs observers (remote → local). They
 * run inside Yjs transaction cleanup on the provider's socket callback, not in
 * React, so a throw there breaks incoming sync but cannot unmount the editor —
 * and Yjs's own `finally` leaves the document usable for local edits.
 */

export interface SyncGuardStatus {
  /** True once a sync call has thrown; cleared when one succeeds again. */
  degraded: boolean;
  /** Total contained failures for this guard. */
  failureCount: number;
  lastError: Error | null;
}

export interface CreateSyncGuardOptions {
  /**
   * Notified (asynchronously) whenever `degraded` flips. Async because errors
   * surface from inside Excalidraw's render pass — a synchronous setState there
   * would be a cross-component update during render.
   */
  onStatusChange?: (status: SyncGuardStatus) => void;
  /** Injectable for tests. */
  logger?: Pick<Console, "error">;
}

/**
 * The slice of `ExcalidrawImperativeAPI` this guard intercepts. The callback
 * signature is left open (`any[]`) so the guard stays agnostic of Excalidraw's
 * onChange arguments — it forwards them untouched.
 */
export interface OnChangeApi {
  onChange: (callback: (...args: any[]) => void) => () => void;
}

export interface SyncGuard {
  /** Wrap a sync callback so a throw is contained and reported, never propagated. */
  wrap: <A extends unknown[]>(
    context: string,
    fn: (...args: A) => void,
  ) => (...args: A) => void;
  /** Run a sync call now, returning `fallback` if it throws. */
  run: <T>(context: string, fn: () => T, fallback: T) => T;
  /**
   * Proxy of an Excalidraw API whose `onChange` subscribers are wrapped. The
   * binding registers its own handler internally, so wrapping the registration
   * is the only seam that can guard it without forking the library.
   */
  guardApi: <T extends OnChangeApi>(api: T) => T;
  getStatus: () => SyncGuardStatus;
}

/** Repeated failures are usually the same bug on every keystroke — log a few, then count. */
const MAX_LOGGED_FAILURES = 3;

export function createSyncGuard(
  options: CreateSyncGuardOptions = {},
): SyncGuard {
  const { onStatusChange, logger = console } = options;

  let degraded = false;
  let failureCount = 0;
  let lastError: Error | null = null;

  const getStatus = (): SyncGuardStatus => ({
    degraded,
    failureCount,
    lastError,
  });

  const setDegraded = (next: boolean) => {
    if (degraded === next) return;
    degraded = next;
    const status = getStatus();
    if (onStatusChange) queueMicrotask(() => onStatusChange(status));
  };

  const reportFailure = (context: string, error: unknown) => {
    failureCount += 1;
    lastError = error instanceof Error ? error : new Error(String(error));
    if (failureCount <= MAX_LOGGED_FAILURES) {
      logger.error(`[diagram sync] contained failure in ${context}:`, error);
      if (failureCount === MAX_LOGGED_FAILURES) {
        logger.error(
          "[diagram sync] further failures will be counted but not logged",
        );
      }
    }
    setDegraded(true);
  };

  const run = <T,>(context: string, fn: () => T, fallback: T): T => {
    try {
      const result = fn();
      setDegraded(false);
      return result;
    } catch (error) {
      reportFailure(context, error);
      return fallback;
    }
  };

  const wrap =
    <A extends unknown[]>(context: string, fn: (...args: A) => void) =>
    (...args: A) => {
      run(context, () => fn(...args), undefined);
    };

  const guardApi = <T extends OnChangeApi>(api: T): T =>
    new Proxy(api, {
      get(target, prop) {
        if (prop === "onChange") {
          return (callback: (...args: any[]) => void) =>
            target.onChange(wrap("excalidrawAPI.onChange", callback));
        }
        // Read and bind against the real API: Excalidraw's methods must never
        // see the proxy as their receiver.
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });

  return { wrap, run, guardApi, getStatus };
}

/**
 * One-off contained call for code with no guard instance — typically a
 * render-time read of the shared document, where a malformed doc should show
 * nothing rather than crash the tree. Reports nowhere but the console; use a
 * `SyncGuard` when the failure should be surfaced to the user.
 */
export function runGuarded<T>(context: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (error) {
    console.error(`[diagram sync] contained failure in ${context}:`, error);
    return fallback;
  }
}
