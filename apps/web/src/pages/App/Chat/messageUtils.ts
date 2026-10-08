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

const TASK_TITLE_MAX = 120;

/**
 * A task title drafted from a message: its first non-empty line, whitespace
 * collapsed, cut at a word boundary past `TASK_TITLE_MAX`. The user edits it
 * before creating, so this only has to be a sensible start.
 */
export function taskTitleFromMessage(plainText: string): string {
  const line = plainText.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).find(Boolean) ?? "";
  if (line.length <= TASK_TITLE_MAX) return line;
  const cut = line.slice(0, TASK_TITLE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > TASK_TITLE_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
