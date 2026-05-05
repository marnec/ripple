/** Build a click handler that:
 *  - Calls `onError(message)` if the resource isn't ready yet (returns null check).
 *  - Awaits the export function, catching errors and surfacing them via `onError`.
 *
 *  Each resource page wires `getResource` (e.g. `() => editor`) so the guard
 *  knows whether the underlying editor / api / binding is ready, plus
 *  `onError` (typically `toast.error`). Keeps per-page click-handler
 *  boilerplate identical across the three ActionsMenu components. */
export function makeExportHandler<T>(
  getResource: () => T | null,
  onError: (message: string) => void,
  notReadyMessage: string,
) {
  return (
    fn: (resource: T) => Promise<void> | void,
    failureMessage: string,
  ): (() => void) => () => {
    const resource = getResource();
    if (resource == null) {
      onError(notReadyMessage);
      return;
    }
    void (async () => {
      try {
        await fn(resource);
      } catch (err) {
        console.error(err);
        onError(failureMessage);
      }
    })();
  };
}
