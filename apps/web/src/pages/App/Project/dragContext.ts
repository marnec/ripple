/**
 * Injectable drag context that replaces the module-level dragTracker.
 * Use createDragContext() in tests for clean isolation.
 * Bridges the browser limitation: dataTransfer payload is unavailable during dragover.
 */

export interface DragContext {
  setDragTask(taskId: string): void;
  clearDragTask(): void;
  readonly currentTaskId: string | null;
}

export function createDragContext(): DragContext {
  let current: string | null = null;
  return {
    setDragTask(id: string) { current = id; },
    clearDragTask() { current = null; },
    get currentTaskId() { return current; },
  };
}
