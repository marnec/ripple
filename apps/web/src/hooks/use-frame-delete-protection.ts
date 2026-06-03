import { useEffect } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

interface UseFrameDeleteProtectionArgs {
  /** The diagram editor's Excalidraw API (null until mounted). */
  api: ExcalidrawImperativeAPI | null;
  /** Disable entirely (e.g. view/presentation mode). */
  enabled: boolean;
  /** Excalidraw ids of frames embedded elsewhere — deleting these is guarded. */
  embeddedFrameIds: Set<string>;
  /**
   * Called instead of the deletion when the user tries to delete a selection
   * containing at least one embedded frame. `frameIds` are the guarded frames;
   * `selectedIds` is the full selection at the moment of the keypress, so the
   * confirm handler can reproduce Excalidraw's "delete frame + contents".
   */
  onIntercept: (frameIds: string[], selectedIds: string[]) => void;
}

/**
 * Excalidraw exposes no before-delete hook, so we intercept the keyboard delete
 * path in the capture phase — running before Excalidraw's own document-level
 * handler (same approach as PresentationOverlay's key handling). When the
 * current selection includes a frame that is embedded somewhere, we swallow the
 * keystroke and hand off to `onIntercept` (which shows the warning dialog);
 * otherwise the event falls through and Excalidraw deletes as usual.
 *
 * Keyboard-only by design: this is inherently a local action, so it never fires
 * on a collaborator's remote deletion.
 */
export function useFrameDeleteProtection({
  api,
  enabled,
  embeddedFrameIds,
  onIntercept,
}: UseFrameDeleteProtectionArgs): void {
  useEffect(() => {
    if (!api || !enabled || embeddedFrameIds.size === 0) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;

      // Ignore deletes that aren't aimed at the canvas: text inputs and
      // Excalidraw's own shape-text editor (a <textarea> inside .excalidraw).
      const target = e.target as HTMLElement | null;
      if (!target || !target.closest(".excalidraw")) return;
      const tag = target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target.isContentEditable
      )
        return;

      const appState = api.getAppState();
      const selectedIds = Object.keys(appState.selectedElementIds).filter(
        (id) => appState.selectedElementIds[id],
      );
      if (selectedIds.length === 0) return;

      const selected = new Set(selectedIds);
      const guarded = api
        .getSceneElements()
        .filter((el) => el.type === "frame" && selected.has(el.id))
        .map((el) => el.id)
        .filter((id) => embeddedFrameIds.has(id));

      if (guarded.length === 0) return; // nothing embedded — let Excalidraw delete

      e.preventDefault();
      e.stopImmediatePropagation();
      onIntercept(guarded, selectedIds);
    };

    // Capture phase: Excalidraw stops propagation of these keys on its own
    // container, so a bubble-phase listener would never see them.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [api, enabled, embeddedFrameIds, onIntercept]);
}
