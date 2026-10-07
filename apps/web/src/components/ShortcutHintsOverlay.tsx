import { createPortal } from "react-dom";
import { Kbd } from "@ripple/ui/components/kbd";
import { formatHint, isMacPlatform, type ShortcutDef, type ShortcutId } from "@/lib/shortcuts";

export interface ShortcutHint {
  id: ShortcutId;
  def: ShortcutDef;
  label: string;
  /** Where the bound control is on screen; null when it has none or it is hidden. */
  rect: DOMRect | null;
}

/** Keeps a badge pinned to a control at the window edge fully on screen. */
const EDGE = 12;

/**
 * Shown while Mod is held (`ShortcutsProvider`). Each shortcut whose control is
 * on screen gets a keycap on that control's top-right corner; the rest — a
 * collapsed sidebar's toggle, search, which has no button — are listed in a
 * legend at the bottom, so every live shortcut is discoverable either way.
 *
 * Purely visual: `pointer-events-none` and `aria-hidden`. The chords themselves
 * are announced where it matters, in each control's tooltip and label.
 */
export function ShortcutHintsOverlay({ hints }: { hints: ShortcutHint[] }) {
  const anchored = hints.filter((hint) => hint.rect);
  const unanchored = hints.filter((hint) => !hint.rect);

  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-100 animate-fade-in [animation-duration:120ms]"
    >
      {anchored.map(({ id, def, rect }) => (
        <Kbd
          key={id}
          className="absolute -translate-x-1/2 -translate-y-1/2 bg-primary font-mono text-primary-foreground shadow-md ring-2 ring-background"
          style={{
            left: Math.min(rect!.right, window.innerWidth - EDGE),
            top: Math.max(rect!.top, EDGE),
          }}
        >
          {formatHint(def)}
        </Kbd>
      ))}

      {unanchored.length > 0 && (
        <div className="absolute bottom-6 left-1/2 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-lg border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur">
          <Kbd>{isMacPlatform() ? "⌘" : "Ctrl"}</Kbd>
          {unanchored.map(({ id, def, label }) => (
            <span key={id} className="flex items-center gap-1.5">
              <Kbd className="font-mono">{formatHint(def)}</Kbd>
              {label}
            </span>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
