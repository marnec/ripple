/**
 * The app's keyboard shortcuts — every `Mod+…` binding is declared here and
 * nowhere else. `useShortcut(id, …)` binds one; holding Mod (⌘ on macOS, Ctrl
 * elsewhere) reveals a badge on each bound control, so what the hint overlay
 * shows and what the keyboard does cannot drift apart.
 */

export interface ShortcutDef {
  /**
   * A single letter, lowercase, or an arrow key (`ArrowLeft`/`ArrowRight`, as
   * `KeyboardEvent.key` names it). Pressed together with Mod.
   */
  key: string;
  shift?: boolean;
  label: string;
  /**
   * `global` shortcuts are bound by the app shell and live everywhere, so their
   * chord is theirs alone. `page` shortcuts are bound by one screen at a time,
   * so two of them may share a chord — Mod+I is "New" on whichever page is
   * open — as long as no global one claims it.
   */
  scope: "global" | "page";
  /**
   * Also fires while typing in an input or editor. Off by default: inside
   * BlockNote, Mod+B/I/U are formatting, and in a plain input a stray chord
   * should do nothing rather than navigate away from what was being typed.
   */
  inInputs?: boolean;
}

export const SHORTCUTS = {
  search: { key: "k", label: "Search", scope: "global", inInputs: true },
  toggleSidebar: { key: "b", label: "Toggle sidebar", scope: "global" },
  focusMode: { key: "f", shift: true, label: "Focus mode", scope: "global", inInputs: true },
  dashboard: { key: "d", label: "My Dashboard", scope: "global" },
  /** The page's primary "New …" — task, document, event, message. */
  create: { key: "i", label: "New", scope: "page" },
  /** ⇧K beside K: search everywhere, or search the list in front of you. */
  searchList: { key: "k", shift: true, label: "Search this list", scope: "page" },
  toggleView: { key: "v", shift: true, label: "Switch view", scope: "page" },
  favorite: { key: "g", shift: true, label: "Favorite", scope: "page" },
  /** Put the caret in the page's main text — a task's description. */
  edit: { key: "e", label: "Edit description", scope: "page" },
  /** ⇧E beside E: the same item in its other shell — sheet ↔ full page. */
  expand: { key: "e", shift: true, label: "Expand", scope: "page" },
  copyLink: { key: "u", label: "Copy link", scope: "page" },
  /**
   * Step through the page's tabs. Arrows, not letters: a direction reads as
   * one, and outside a text field Mod+⇧←/→ does nothing in any browser. Not
   * Mod+1…9, which is how people switch browser tabs.
   */
  prevTab: { key: "ArrowLeft", shift: true, label: "Previous tab", scope: "page" },
  nextTab: { key: "ArrowRight", shift: true, label: "Next tab", scope: "page" },
} as const satisfies Record<string, ShortcutDef>;

export type ShortcutId = keyof typeof SHORTCUTS;

/**
 * Keys a binding must never use. `n t w` (and their Shift forms) are never
 * delivered to the page by Chrome; `q h m` belong to macOS; the editing keys
 * would break copy/paste/undo; the rest are browser features people reach for
 * without thinking (find, print, reload, address bar, save).
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "n", "t", "w", "q", "h", "m",
  "a", "c", "v", "x", "y", "z",
  "f", "p", "r", "l", "s",
]);

/**
 * Shift unlocks a reserved letter only where the browser leaves it free — and
 * where no common extension has claimed it. Extensions register their chords
 * with the browser, so the page never sees the keydown: the shortcut simply
 * does nothing for anyone who has the extension installed.
 */
export const RESERVED_WITH_SHIFT: ReadonlySet<string> = new Set([
  "n", "t", "w", "q", "z", "c", "i", "j",
  "s", // Zotero Connector: save to Zotero
  "l", "u", "y", // Bitwarden: autofill login, autofill card, open vault
  "x", // 1Password: fill
]);

export const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** The physical modifier the platform's shortcuts are pressed with. */
export const modKeyName = (isMac: boolean) => (isMac ? "Meta" : "Control");

/**
 * Prefers `event.key` so the binding follows the printed letter on AZERTY or
 * Dvorak; falls back to `event.code` when the layout produces no Latin letter
 * (Cyrillic, Greek), so the shortcut still works there on the QWERTY position.
 */
export function matchesShortcut(def: ShortcutDef, event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
  if (event.shiftKey !== Boolean(def.shift)) return false;
  // Named keys are the same on every layout.
  if (def.key.length > 1) return event.key === def.key;
  const key = event.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key === def.key;
  return event.code === `Key${def.key.toUpperCase()}`;
}

/**
 * True when focus is somewhere that owns its own keyboard: a text field, a
 * contenteditable editor, or a surface that opts out via `data-owns-keyboard`
 * (the Excalidraw canvas, where Mod+D duplicates and Mod+G groups).
 */
export function isKeyboardOwned(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (element as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"].includes(type);
  }
  return element.closest("[data-owns-keyboard]") !== null;
}

/** The badge text shown while Mod is held — Mod itself is implied. */
const KEY_GLYPHS: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→" };

export const formatHint = (def: ShortcutDef) =>
  `${def.shift ? "⇧" : ""}${KEY_GLYPHS[def.key] ?? def.key.toUpperCase()}`;
