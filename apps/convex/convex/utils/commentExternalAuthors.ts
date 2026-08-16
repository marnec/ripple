import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** The external-author chip a mirrored comment renders instead of a Ripple avatar. */
export type ExternalCommentAuthor = NonNullable<
  Doc<"taskCommentIntegrationLinks">["externalAuthor"]
>;

/**
 * External author (if any) for each of a task's comments, keyed by comment id.
 *
 * `taskCommentIntegrationLinks` has no task-scoped index — only
 * `by_taskComment` — so this is one indexed lookup per comment. That query
 * COUNT is a deliberate design choice (the link table is small per task); what
 * is not deliberate is paying it serially, which is what `taskComments.list`
 * did with an `await` inside a `for` loop while `taskActivity.timeline`, on the
 * same screen, ran the identical lookups through `Promise.all`.
 *
 * Extracted so the two callers share one shape rather than two spellings of it.
 * Only inbound (external-authored) comments carry an `externalAuthor`:
 * Ripple-originated comments have a link row with none, and must keep their
 * real author's avatar rather than picking up a bot chip.
 */
export async function externalAuthorsByComment(
  ctx: QueryCtx,
  commentIds: Id<"taskComments">[],
): Promise<Map<Id<"taskComments">, ExternalCommentAuthor>> {
  const links = await Promise.all(
    commentIds.map((commentId) =>
      ctx.db
        .query("taskCommentIntegrationLinks")
        .withIndex("by_taskComment", (q) => q.eq("taskCommentId", commentId))
        .unique(),
    ),
  );

  const byComment = new Map<Id<"taskComments">, ExternalCommentAuthor>();
  links.forEach((link, i) => {
    if (link?.externalAuthor) byComment.set(commentIds[i], link.externalAuthor);
  });
  return byComment;
}
