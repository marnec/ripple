/**
 * Module-level drag tracker.
 *
 * Browsers don't allow reading dataTransfer payload during dragover (only the
 * declared MIME types are visible), so we use this shared variable to let the
 * drag-source component communicate the dragging task ID to the dragover handler.
 */
export let currentDragTaskId: string | null = null;

export function startDrag(taskId: string) {
  currentDragTaskId = taskId;
}

export function endDrag() {
  currentDragTaskId = null;
}
