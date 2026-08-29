/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState } from "react";
import { useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";

interface FocusModeContextValue {
  /**
   * The app chrome — sidebar, breadcrumb header, surface header — is hidden and
   * the current surface owns the whole viewport.
   */
  isFocused: boolean;
  /**
   * Focus mode is offered at all. False on mobile, where the chrome it would
   * hide is already minimal and the viewport bottom — the only free edge left
   * for the exit control — belongs to the editors' own toolbars.
   */
  isFocusAvailable: boolean;
  enterFocus: () => void;
  exitFocus: () => void;
  toggleFocus: () => void;
}

const FocusModeContext = createContext<FocusModeContextValue | null>(null);

export function useFocusMode() {
  const ctx = useContext(FocusModeContext);
  if (!ctx) throw new Error("useFocusMode must be used within FocusModeProvider");
  return ctx;
}

/**
 * Distraction-free viewing of one surface.
 *
 * Deliberately *not* an overlay: a diagram's canvas is bound to a Yjs document
 * and holds camera state Excalidraw only keeps in its own component, so
 * re-mounting it into a fullscreen portal would reset the view and re-run the
 * binding. Focus mode is a layout state instead — the same tree, with the
 * chrome hidden and the surface promoted to the viewport (`Layout`).
 *
 * Session state on purpose. It is a per-visit choice, not a preference, and
 * persisting it would mean landing on a chrome-less page you didn't ask for.
 */
export function FocusModeProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  // Focus is held *as* the route it was entered on, not as a boolean. The only
  // way out lives on the focused surface, so a navigation away from it — a
  // command-palette jump, a browser back, a link in the content — must drop
  // focus, or the next page renders with no chrome and no exit. Deriving it
  // from the location does that with no effect and no render-phase reset; the
  // one visible consequence is that coming back to the surface (from its own
  // settings route, say) comes back focused, which is what you wanted anyway.
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  // Availability is applied here, not at each control, so that narrowing the
  // window while focused hands the chrome straight back instead of stranding
  // the user under a mobile layout whose exit control is behind a toolbar.
  const isFocusAvailable = !useIsMobile();
  const isFocused = isFocusAvailable && focusedPath === pathname;

  const value: FocusModeContextValue = {
    isFocused,
    isFocusAvailable,
    enterFocus: () => setFocusedPath(pathname),
    exitFocus: () => setFocusedPath(null),
    toggleFocus: () => setFocusedPath(isFocused ? null : pathname),
  };

  return <FocusModeContext value={value}>{children}</FocusModeContext>;
}
