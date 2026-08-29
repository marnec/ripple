import { flip, offset, shift, size } from "@floating-ui/react";

/**
 * Positioning for BlockNote's suggestion menus (`/`, `@`, `#`).
 *
 * BlockNote's chain is `offset → autoPlacement → shift → size`, and it strands
 * the menu whenever the editor sits near the bottom of the viewport — measured
 * in the comments rail: caret at y=938 of a 1000px viewport (62px below, 918px
 * above), menu rendered *below* at `maxHeight: 42px` against a `scrollHeight`
 * of 1304px. One group heading, no items.
 *
 * Two things combine to produce that:
 *
 *  - `getItems` is async, so the menu is measured and placed while it is still
 *    empty. An empty menu fits anywhere, so `bottom-start` is chosen.
 *  - `size` then pins `maxHeight` to the space on that side — 42px. When the
 *    items land, the element *cannot grow past the pin*, so the ResizeObserver
 *    behind `autoUpdate` sees no size change and never asks for a reposition.
 *    The first (content-free) guess becomes permanent.
 *
 * The fix is to keep the menu able to grow: `size` clamps to the available
 * space but never below `MIN_MENU_HEIGHT`. The moment items arrive the element
 * grows from 42px toward that floor, which *does* fire the ResizeObserver, and
 * the recomputed pass sees a menu that no longer fits below.
 *
 * `flip` replaces `autoPlacement` for that pass: it keeps a preferred
 * placement and moves only on real overflow, where `autoPlacement` ranks
 * placements against each other using the element's current — repeatedly
 * clamped — height, which is what let the bad side keep winning.
 *
 * `useFloatingOptions` and `elementProps` are each spread *after* BlockNote's
 * defaults, so `middleware` replaces the whole chain and `style` replaces
 * theirs outright (hence z-index is restated here).
 */

/**
 * Enough that arriving items visibly change the element's height. Below this,
 * the menu is pinned too tightly to ever trigger a reposition.
 */
const MIN_MENU_HEIGHT = 240;

export const SUGGESTION_MENU_FLOATING_OPTIONS = {
  useFloatingOptions: {
    placement: "bottom-start" as const,
    middleware: [
      offset(10),
      flip({ fallbackPlacements: ["top-start"], padding: 10 }),
      shift({ padding: 10 }),
      size({
        padding: 10,
        apply({ elements, availableHeight }) {
          elements.floating.style.maxHeight = `${Math.max(availableHeight, MIN_MENU_HEIGHT)}px`;
        },
      }),
    ],
  },
};
