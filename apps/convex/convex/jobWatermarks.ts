/**
 * How far a periodic job has already read through an append-only source.
 *
 * A cron that pages a window it does not own re-sees the same rows on every
 * run, and "have I handled this one?" has no answer unless the job keeps its
 * own place. Recording a monotonic high-water mark answers it in one indexed
 * read, and — unlike deriving the answer from whatever the job wrote last
 * time — survives that output being deleted. That distinction is the reason
 * this exists: the dead-letter mirror's output is `backgroundJobFailures`,
 * whose whole contract is that an operator can dismiss a row.
 *
 * Closed for modification, open for extension: a new periodic job picks a
 * `job` name and calls these two functions. There is nothing here to change
 * and nothing per-job to add — no table, no index, no branch.
 *
 * The two rules a caller must honour:
 *  - `cursor` is monotonic in the source's own ordering, and the caller reads
 *    strictly past it (`> cursor`), so ordering is the caller's to get right.
 *  - Advance only after the work is durable. Both functions run inside the
 *    caller's mutation, so the watermark commits in the same transaction as
 *    the work it accounts for — advance and work are never half-applied.
 */

import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * The mark this job last reached, or `0` for a job that has never run — which
 * makes a first run read the source from the beginning.
 */
export async function readWatermark(
  ctx: QueryCtx,
  job: string,
): Promise<number> {
  const row = await ctx.db
    .query("jobWatermarks")
    .withIndex("by_job", (q) => q.eq("job", job))
    .unique();
  return row?.cursor ?? 0;
}

/**
 * Move the mark forward. Never backwards: a job that processes an out-of-order
 * batch, or one whose two runs overlap, must not re-open a window it already
 * closed.
 */
export async function advanceWatermark(
  ctx: MutationCtx,
  job: string,
  cursor: number,
): Promise<void> {
  const row = await ctx.db
    .query("jobWatermarks")
    .withIndex("by_job", (q) => q.eq("job", job))
    .unique();

  if (!row) {
    await ctx.db.insert("jobWatermarks", { job, cursor });
    return;
  }
  if (cursor > row.cursor) {
    await ctx.db.patch(row._id, { cursor });
  }
}
