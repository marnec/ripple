import { describe, expect, it } from "vitest";
import {
  formatHint,
  isKeyboardOwned,
  matchesShortcut,
  RESERVED_KEYS,
  RESERVED_WITH_SHIFT,
  SHORTCUTS,
  type ShortcutDef,
} from "./shortcuts";

const press = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("shortcut catalog", () => {
  const defs: [string, ShortcutDef][] = Object.entries(SHORTCUTS);

  const chord = (d: ShortcutDef) => `${d.shift ? "shift+" : ""}${d.key}`;

  it("gives every global shortcut a chord no other shortcut uses", () => {
    for (const [id, def] of defs) {
      if (def.scope !== "global") continue;
      const sharing = defs.filter(([other, d]) => other !== id && chord(d) === chord(def));
      expect(sharing.map(([other]) => other), `${id} shares Mod+${formatHint(def)}`).toEqual([]);
    }
  });

  it("never takes a key the browser, the OS or text editing owns", () => {
    for (const [id, def] of defs) {
      const reserved = def.shift ? RESERVED_WITH_SHIFT : RESERVED_KEYS;
      expect(reserved.has(def.key), `${id} uses reserved Mod+${formatHint(def)}`).toBe(false);
    }
  });

  it("uses single lowercase letters", () => {
    for (const [, def] of defs) expect(def.key).toMatch(/^[a-z]$/);
  });
});

describe("matchesShortcut", () => {
  const def: ShortcutDef = { key: "k", label: "Search", scope: "global" };

  it("matches with either Ctrl or ⌘", () => {
    expect(matchesShortcut(def, press({ key: "k", ctrlKey: true }))).toBe(true);
    expect(matchesShortcut(def, press({ key: "k", metaKey: true }))).toBe(true);
  });

  it("requires the modifier and an exact Shift state", () => {
    expect(matchesShortcut(def, press({ key: "k" }))).toBe(false);
    expect(matchesShortcut(def, press({ key: "K", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matchesShortcut({ ...def, shift: true }, press({ key: "K", ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("ignores Alt chords, which type characters on macOS", () => {
    expect(matchesShortcut(def, press({ key: "k", metaKey: true, altKey: true }))).toBe(false);
  });

  it("follows the printed letter, falling back to the physical key on non-Latin layouts", () => {
    // AZERTY: the key printed "A" sits where QWERTY has Q.
    expect(matchesShortcut({ key: "a", label: "", scope: "page" }, press({ key: "a", code: "KeyQ", ctrlKey: true }))).toBe(true);
    // Russian layout: "л" is on the K position.
    expect(matchesShortcut(def, press({ key: "л", code: "KeyK", ctrlKey: true }))).toBe(true);
  });
});

describe("isKeyboardOwned", () => {
  const el = (html: string) => {
    document.body.innerHTML = html;
    return document.body.querySelector("[data-target]");
  };

  it("is true for text fields and editors", () => {
    expect(isKeyboardOwned(el(`<input data-target />`))).toBe(true);
    expect(isKeyboardOwned(el(`<textarea data-target></textarea>`))).toBe(true);
    const editable = el(`<div data-target contenteditable="true"></div>`) as HTMLElement;
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isKeyboardOwned(editable)).toBe(true);
  });

  it("is true inside a surface that owns its keyboard", () => {
    expect(isKeyboardOwned(el(`<div data-owns-keyboard><canvas data-target></canvas></div>`))).toBe(true);
  });

  it("is false for buttons, checkboxes and the page itself", () => {
    expect(isKeyboardOwned(el(`<button data-target></button>`))).toBe(false);
    expect(isKeyboardOwned(el(`<input type="checkbox" data-target />`))).toBe(false);
    expect(isKeyboardOwned(document.body)).toBe(false);
    expect(isKeyboardOwned(null)).toBe(false);
  });
});
