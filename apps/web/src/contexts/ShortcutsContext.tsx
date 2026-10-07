/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ShortcutHintsOverlay, type ShortcutHint } from "@/components/ShortcutHintsOverlay";
import {
  isKeyboardOwned,
  isMacPlatform,
  matchesShortcut,
  modKeyName,
  SHORTCUTS,
  type ShortcutDef,
  type ShortcutId,
} from "@/lib/shortcuts";

/**
 * How long Mod must be held alone before the hints appear. Long enough that
 * the press-and-chord of an ordinary Mod+C never flashes the overlay, short
 * enough that a deliberate hold doesn't feel like waiting.
 */
const HOLD_MS = 400;

interface Binding {
  id: ShortcutId;
  run: () => void;
  anchor: HTMLElement | null;
  label?: string;
}

class ShortcutRegistry {
  // An array, not a map keyed by id: when two mounted components bind the same
  // id (a page and the dialog open over it), the newest one wins, and when it
  // unmounts the older one is still there to take over.
  #bindings: Binding[] = [];

  register(binding: Binding) {
    this.#bindings.push(binding);
    return () => {
      this.#bindings = this.#bindings.filter((b) => b !== binding);
    };
  }

  /** The newest binding per id that can fire with focus where it is. */
  active(keyboardOwned: boolean): Binding[] {
    const seen = new Set<ShortcutId>();
    const result: Binding[] = [];
    for (let i = this.#bindings.length - 1; i >= 0; i--) {
      const binding = this.#bindings[i];
      if (seen.has(binding.id)) continue;
      seen.add(binding.id);
      const def: ShortcutDef = SHORTCUTS[binding.id];
      if (keyboardOwned && !def.inInputs) continue;
      result.push(binding);
    }
    return result;
  }
}

const ShortcutsContext = createContext<ShortcutRegistry | null>(null);

function isShown(element: HTMLElement): boolean {
  if (!element.isConnected || !element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

/** The shortcuts that would fire with focus on `target`, and where they live. */
function snapshot(registry: ShortcutRegistry, target: Element | null): ShortcutHint[] {
  return registry.active(isKeyboardOwned(target)).map((binding) => ({
    id: binding.id,
    def: SHORTCUTS[binding.id],
    label: binding.label ?? SHORTCUTS[binding.id].label,
    rect: binding.anchor && isShown(binding.anchor) ? binding.anchor.getBoundingClientRect() : null,
  }));
}

/**
 * Owns every `Mod+…` shortcut in the app (see `lib/shortcuts.ts`): one keydown
 * listener dispatches them, and holding Mod alone shows where they live.
 *
 * Capture phase, like the listener it replaced: BlockNote and Excalidraw stop
 * propagation of key events inside their containers, so a bubble-phase
 * listener never hears Mod+K while an editor has focus.
 */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(() => new ShortcutRegistry());
  const [hints, setHints] = useState<ShortcutHint[] | null>(null);

  useEffect(() => {
    const mod = modKeyName(isMacPlatform());
    let timer: ReturnType<typeof setTimeout> | undefined;

    const hide = () => {
      clearTimeout(timer);
      timer = undefined;
      setHints(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // The element the key goes to — for the hints as for the dispatch, so
      // the overlay never advertises a chord that would be ignored here.
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === mod) {
        // Windows and Linux auto-repeat a held modifier; restarting the timer
        // on every repeat would keep the hints from ever appearing.
        if (event.repeat) return;
        hide();
        timer = setTimeout(() => setHints(snapshot(registry, target)), HOLD_MS);
        return;
      }
      // Shift is part of a chord the hints advertise (⇧F) — reaching for it
      // must not dismiss them. Any other key is a chord or typing: hide.
      if (event.key !== "Shift") hide();

      const binding = registry.active(isKeyboardOwned(target)).find((b) => matchesShortcut(SHORTCUTS[b.id], event));
      if (!binding) return;
      event.preventDefault();
      if (!event.repeat) binding.run();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === mod) hide();
    };

    const onVisibilityChange = () => {
      if (document.hidden) hide();
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    // Positions are measured once, on show: anything that moves the page
    // dismisses the hints rather than leaving them pointing at stale spots.
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("resize", hide);
    // The keyup never arrives if Mod is released after focus leaves the
    // window (⌘-Tab away), which would strand the overlay on screen.
    window.addEventListener("blur", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  }, [registry]);

  return (
    <ShortcutsContext value={registry}>
      {children}
      {hints && <ShortcutHintsOverlay hints={hints} />}
    </ShortcutsContext>
  );
}

/**
 * Binds the catalog shortcut `id` to `run` while the calling component is
 * mounted and `enabled`. Returns a ref callback: attach it to the control the
 * shortcut stands for and the hint badge appears on that control; leave it
 * unattached and the shortcut is listed in the overlay's legend instead.
 *
 * A no-op outside `ShortcutsProvider`, so components that bind shortcuts still
 * render in isolation (tests, the guest share views).
 */
export function useShortcut(
  id: ShortcutId,
  run: () => void,
  {
    enabled = true,
    label,
  }: {
    enabled?: boolean;
    /** What this page calls the action — "New event" for the generic "New". */
    label?: string;
  } = {},
) {
  const registry = useContext(ShortcutsContext);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const runRef = useRef(run);

  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    if (!registry || !enabled) return;
    return registry.register({ id, anchor, label, run: () => runRef.current() });
  }, [registry, id, enabled, anchor, label]);

  return setAnchor;
}
