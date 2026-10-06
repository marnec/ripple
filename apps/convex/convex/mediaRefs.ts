import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MediaOwnerType } from "./utils/mediaTokens";

/**
 * The one way `mediaRefs` changes. An owner — a message, a comment, a
 * collaborative resource — states the full set of upload tokens its content
 * holds right now; this makes the stored references match it.
 *
 * A reference appearing clears its upload's `orphanedAt`; the last one going
 * sets it, which starts the grace period after which `storageGc` collects the
 * upload. Nothing is deleted here: an edit that drops an image and an undo that
 * brings it back must both be harmless, and that is what the grace period buys.
 *
 * Tokens with no `medias` row (another deployment's URL, a pre-token upload not
 * yet backfilled) are ignored. Workspace is deliberately not checked: a
 * reference only extends how long a file is kept, it grants no access —
 * `medias.getUrl` still applies the workspace rule — so honouring a URL pasted
 * across workspaces errs towards keeping a file that is on screen somewhere.
 *
 * Takes `{ db }` so a trigger's context (the same writer, typed through
 * convex-helpers) can call it as readily as a mutation.
 */
export async function syncOwnerRefs(
  ctx: Pick<MutationCtx, "db">,
  owner: { type: MediaOwnerType; id: string },
  tokens: readonly string[],
): Promise<void> {
  // Bounded by the uploads one piece of content embeds. Iterated rather than
  // capped with `take`: a missed row would be re-inserted as a duplicate.
  const existing: Doc<"mediaRefs">[] = [];
  for await (const ref of ctx.db
    .query("mediaRefs")
    .withIndex("by_owner", (q) => q.eq("ownerType", owner.type).eq("ownerId", owner.id))) {
    existing.push(ref);
  }

  const wanted = new Set<Id<"medias">>();
  for (const token of tokens) {
    const media = await ctx.db
      .query("medias")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (media) wanted.add(media._id);
  }

  const have = new Set(existing.map((ref) => ref.mediaId));

  for (const mediaId of wanted) {
    if (have.has(mediaId)) continue;
    await ctx.db.insert("mediaRefs", { mediaId, ownerType: owner.type, ownerId: owner.id });
    const media = await ctx.db.get(mediaId);
    if (media?.orphanedAt !== undefined) {
      await ctx.db.patch(mediaId, { orphanedAt: undefined });
    }
  }

  for (const ref of existing) {
    if (wanted.has(ref.mediaId)) continue;
    await ctx.db.delete(ref._id);
    await markOrphanedIfUnreferenced(ctx, ref.mediaId);
  }
}

/** Drop every reference an owner holds — it was deleted, or its content hidden. */
export function releaseOwnerRefs(
  ctx: Pick<MutationCtx, "db">,
  owner: { type: MediaOwnerType; id: string },
): Promise<void> {
  return syncOwnerRefs(ctx, owner, []);
}

/**
 * Start the grace period for an upload nothing references any more. Untracked
 * (pre-backfill) rows are left alone — an absent reference proves nothing for
 * them. The row may already be gone: a workspace cascade deletes uploads and
 * their owners in the same sweep.
 */
async function markOrphanedIfUnreferenced(
  ctx: Pick<MutationCtx, "db">,
  mediaId: Id<"medias">,
): Promise<void> {
  const media = await ctx.db.get(mediaId);
  if (!media?.tracked || media.orphanedAt !== undefined) return;
  const remaining = await ctx.db
    .query("mediaRefs")
    .withIndex("by_media", (q) => q.eq("mediaId", mediaId))
    .first();
  if (!remaining) await ctx.db.patch(mediaId, { orphanedAt: Date.now() });
}
