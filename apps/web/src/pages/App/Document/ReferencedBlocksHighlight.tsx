/**
 * Renders a <style> tag that highlights blocks referenced by embeds elsewhere.
 * Rules are generated dynamically from `blockIds` because ProseMirror preserves
 * `data-id` on re-render but wipes custom attributes — selecting via attribute
 * is the only stable hook.
 *
 * Both states (active + exit) declare the same `transition` property, so
 * swapping the rendered rule when `active` flips animates smoothly without
 * any timer-based mount lifecycle. The exit rule's values match the editor's
 * neutral defaults (transparent border, no padding offset), so the initial
 * render is also visually flat.
 */
export function ReferencedBlocksHighlight({
  blockIds,
  active,
}: {
  blockIds: ReadonlySet<string>;
  active: boolean;
}) {
  if (blockIds.size === 0) return null;

  const selector = [...blockIds]
    .map((id) => `.bn-block-outer[data-id="${id}"] > .bn-block`)
    .join(",\n");

  return <style>{active ? activeRule(selector) : exitRule(selector)}</style>;
}

function activeRule(selector: string) {
  return `${selector} {
  border-left: 2px solid hsl(45 90% 50% / 0.5);
  background-color: hsl(45 90% 50% / 0.06);
  padding-left: 6px;
  border-radius: 0 4px 4px 0;
  transition: border-color 0.2s, background-color 0.2s, padding-left 0.2s;
}`;
}

function exitRule(selector: string) {
  return `${selector} {
  border-left: 2px solid transparent;
  background-color: transparent;
  padding-left: 0;
  transition: border-color 0.2s, background-color 0.2s, padding-left 0.2s;
}`;
}
