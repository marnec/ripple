/**
 * Renders a <style> tag that marks blocks referenced by embeds elsewhere.
 * Rules are generated dynamically from `blockIds` because ProseMirror preserves
 * `data-id` on re-render but wipes custom attributes — selecting via attribute
 * is the only stable hook.
 *
 * A small ↗ marker always sits trailing each referenced block — subtle,
 * non-blocking awareness while editing.
 */
export function ReferencedBlocksHighlight({
  blockIds,
}: {
  blockIds: ReadonlySet<string>;
}) {
  if (blockIds.size === 0) return null;

  const ids = [...blockIds];
  const markerSelector = ids
    .map(
      (id) =>
        `.bn-block-outer[data-id="${id}"] > .bn-block > .bn-block-content::after`,
    )
    .join(",\n");

  return <style>{markerRule(markerSelector)}</style>;
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
