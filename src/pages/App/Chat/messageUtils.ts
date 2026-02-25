/** Check whether any top-level block is an image */
export function hasImageBlocks(blocks: { type: string }[]): boolean {
  return blocks.some((b) => b.type === "image");
}
