/**
 * What a `taskReassignPool` drain leaves behind when it gives up.
 *
 * The two delete drains commit their decision in the user-facing mutation and
 * leave the bulk rewrite to the pool: `taskStatuses.remove` and
 * `tagSync.deleteTag` both set `pendingDeletion: true`, which is what retires
 * the row from `listByProject` / `listWorkspaceTags` before a single task or
 * join has moved. Recording the give-up in `backgroundJobFailures` makes that
 * visible to an operator, but it does nothing for the workspace: the flag has
 * no other writer anywhere, so an exhausted drain wedges the row hidden — a
 * column gone from the board whose tasks still point at it and drop out of
 * every group, a tag gone from every picker but still on every resource and
 * unusable by name. The user's one recovery, re-running Delete, is refused with
 * "already in progress" forever.
 *
 * So giving up clears the flag. The row returns to exactly the state the delete
 * interrupted — visible again, still carrying whatever the drain did not get
 * to — and Delete can simply be pressed again. A drain that moved some of its
 * tasks before dying leaves the column short those tasks; that is a partial
 * result the user can see and act on, which is the whole difference from a
 * wedge they cannot.
 */

import { vOnCompleteArgs } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internalMutation } from "./functions";
import { insertJobFailure, vJobContext } from "./backgroundJobFailures";

/**
 * Which drains retire a row, and where that row lives. Keyed by the `kind` the
 * enqueue site named, not by the shape of `key`: `syncTasksCompleted` is also
 * keyed by a status id and retires nothing, and clearing the flag on its
 * give-up would put a column back on the board while its *delete* drain is
 * still running.
 */
const RETIRED_BY: Record<string, "taskStatuses" | "tags" | undefined> = {
  "taskStatuses:reassignTasksAndDelete": "taskStatuses",
  "tagSync:stripTagEverywhere": "tags",
};

/**
 * `onComplete` for `taskReassignPool` — `backgroundJobFailures.recordTerminalFailure`
 * plus the un-retiring above, for the drains that retired something.
 */
export const recordDrainGiveUp = internalMutation({
  args: vOnCompleteArgs(vJobContext),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    if (result.kind !== "failed") return null;

    await insertJobFailure(ctx, {
      kind: context.kind,
      key: context.key,
      error: result.error,
    });

    const table = RETIRED_BY[context.kind];
    if (table === undefined) return null;

    const rowId = ctx.db.normalizeId(table, context.key);
    // The row is gone when a later delete of the same column or tag succeeded
    // while this one was still backing off.
    if (rowId === null || (await ctx.db.get(rowId)) === null) return null;

    // Undefined rather than `false`: the readers test `!== true`, and a row
    // that was never deleted carries no field at all.
    await ctx.db.patch(rowId, { pendingDeletion: undefined });
    return null;
  },
});
