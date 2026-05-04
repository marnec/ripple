/**
 * Renders a <style> tag that marks blocks referenced by embeds elsewhere.
 * Rules are generated dynamically from `blockIds` because ProseMirror preserves
 * `data-id` on re-render but wipes custom attributes — selecting via attribute
 * is the only stable hook.
 *
 * Two visual modes:
 * - resting (`active=false`): a small ↗ marker always sits trailing the
 *   referenced block. Subtle, non-blocking awareness while editing.
 * - active (`active=true`): louder amber border + bg tint + padding shift,
 *   shown on every referenced block when the user toggles the References panel.
 */
export function ReferencedBlocksHighlight({
  blockIds,
  active,
}: {
  blockIds: ReadonlySet<string>;
  active: boolean;
}) {
  if (blockIds.size === 0) return null;

  const ids = [...blockIds];
  const activeSelector = ids
    .map((id) => `.bn-block-outer[data-id="${id}"] > .bn-block`)
    .join(",\n");

  if (active) {
    return <style>{activeRule(activeSelector)}</style>;
  }

  const markerSelector = ids
    .map(
      (id) =>
        `.bn-block-outer[data-id="${id}"] > .bn-block > .bn-block-content::after`,
    )
    .join(",\n");

  return <style>{markerRule(markerSelector)}</style>;
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

function markerRule(selector: string) {
  return `${selector} {
  content: '↗';
  align-self: flex-start;
  margin-left: 0.5em;
  margin-top: 0.15em;
  font-size: 0.7em;
  font-weight: 600;
  line-height: 1;
  color: hsl(45 90% 50% / 0.5);
  pointer-events: none;
}`;
}
