/**
 * Trailing spacer for a scroll pane, sized to the bottom safe-area inset.
 *
 * With `viewport-fit=cover`, iOS lays the page out *under* the home indicator
 * and — since Safari 26 — under the floating Liquid Glass toolbar, reporting
 * both through `env(safe-area-inset-bottom)`. Without this, the last rows of a
 * list sit beneath the toolbar and can't be scrolled clear of it.
 *
 * A spacer rather than padding on the scroller: it only shows at the very end
 * of the scroll, composes with whatever padding the pane already has, and is
 * zero-height wherever the inset is 0 (desktop, Android, older Safari), so
 * nobody else sees a difference.
 */
export function SafeAreaSpacer() {
  return <div aria-hidden className="h-(--safe-area-bottom) shrink-0" />;
}
