import type { PortalElementsMap } from "@blocknote/react";

/**
 * Portals an editor's floating UI (slash menu, `@`/`#` suggestion menus, link
 * toolbar…) into `document.body`.
 *
 * BlockNote positions those with floating-ui's default `absolute` strategy and
 * renders them into `editor.portalElement`, a div it appends **inside the
 * editor's `bn-container`**. Any `overflow: hidden` between that container and
 * the viewport therefore clips the menu — which is fine for a full-height
 * editor and fatal for a short one: the comment composers are a strip a few
 * rows tall at the bottom of a rail whose wrapper is `overflow-hidden` (it has
 * to be — that is what clips the height: 0 → auto open animation), so the slash
 * menu was cut off after its first group heading.
 *
 * `default: null` is BlockNote's own escape hatch for exactly this. The portal
 * div keeps its `bn-root` + theme classes and `data-color-scheme` wherever it
 * is mounted (`BlockNoteView` re-applies them on every render), so moving it
 * costs nothing in styling.
 */
export const BODY_PORTAL_ELEMENTS: PortalElementsMap = { default: null };
