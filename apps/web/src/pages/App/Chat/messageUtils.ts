/** Check whether any top-level block is an image */
export function hasImageBlocks(blocks: { type: string }[]): boolean {
  return blocks.some((b) => b.type === "image");
}

/**
 * Which of the two attachment paths a picked, pasted or dropped file takes.
 *
 * `image` means the thumbnail-plus-full upload that renders inline in the
 * message; `file` means the single blob behind an attachment card. The MIME
 * type is the only input — a `.png` renamed to `.dat` is a file, which is the
 * honest answer, since nothing downstream would be able to decode it either.
 */
export function attachmentKindFor(mimeType: string | undefined): "image" | "file" {
  return mimeType?.startsWith("image/") ? "image" : "file";
}
