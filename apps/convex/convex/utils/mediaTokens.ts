import { v, type Infer } from "convex/values";

/**
 * How content points at an upload. A Convex storage URL is
 * `https://<deployment>/api/storage/<uuid>`, and the uuid is *not* the
 * `Id<"_storage">` — it is an opaque token minted by `ctx.storage.getUrl`. So
 * content can only be matched back to its `medias` row through this token,
 * which `saveMedia` records (`medias.token`).
 *
 * Matched on the path, not the full URL, so a change of deployment host
 * (custom domain, a restored backup) does not orphan everything already
 * written.
 */
const STORAGE_TOKEN = /\/api\/storage\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g;

/**
 * Every upload token in `text`, deduplicated and lowercased. Format-agnostic on
 * purpose — it reads a message's BlockNote JSON, a comment body and the raw
 * bytes of a Yjs snapshot (decoded as UTF-8: Yjs writes attribute strings as
 * plain UTF-8, so a URL in an image block survives intact while the binary
 * framing around it decodes to noise the pattern cannot match).
 *
 * Over-matching is the safe direction: a token found in deleted-but-not-yet-
 * GC'd Yjs content keeps a file alive a little longer; a missed one would let
 * a file still on screen be collected.
 */
export function extractMediaTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const match of text.matchAll(STORAGE_TOKEN)) {
    tokens.add(match[1].toLowerCase());
  }
  return [...tokens];
}

/** The token of a storage URL, or null when it is not one. */
export function mediaTokenFromUrl(url: string): string | null {
  return extractMediaTokens(url)[0] ?? null;
}

/**
 * What can hold a reference to an upload. Content-bearing rows (messages,
 * comments) and the collaborative resources whose Yjs snapshot embeds images.
 */
export const mediaOwnerTypeValidator = v.union(
  v.literal("message"),
  v.literal("taskComment"),
  v.literal("document"),
  v.literal("task"),
  v.literal("diagram"),
  v.literal("spreadsheet"),
);
export type MediaOwnerType = Infer<typeof mediaOwnerTypeValidator>;
