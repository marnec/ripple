import type { WithoutSystemFields } from "convex/server";
import type { MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

/**
 * The single writer for a task's external linkage. A task's link to an external
 * issue lives in the nested array `tasks.externalRefs`; because Convex can't
 * index nested arrays, a denormalized `taskExternalRefs` lookup mirrors it so
 * the PR-sync reconciler can resolve "which task carries issue #N in repo X"
 * with a point index lookup instead of scanning every task in the project.
 *
 * The two stores MUST never diverge. This module is the only place that writes
 * `tasks.externalRefs`: every entry point performs the canonical write AND
 * reconciles the lookup in the same call, so the invariant is structural rather
 * than a convention each caller has to remember. `reconcileTaskExternalRefs`
 * below is deliberately NOT exported — there is no path to write the refs
 * without the lookup following.
 *
 * Task DELETION is handled separately by cascadeDelete.ts (the `taskExternalRefs`
 * table is registered there), so this module never deletes tasks.
 */

/** A task's single external link. `externalRefs` is conventionally one entry. */
export interface TaskExternalRef {
  provider: string;
  repoFullName: string;
  issueNumber: number;
  url: string;
  deleted?: boolean;
}

/**
 * Extra task fields to patch atomically in the same write as the link change
 * (e.g. `externalRefFrozen` on disconnect/reconnect). `externalRefs` is
 * excluded on purpose — this module owns it, so `alsoPatch` can't become a back
 * door for an un-mirrored ref write.
 */
type TaskLinkPatch = Partial<
  Omit<Doc<"tasks">, "_id" | "_creationTime" | "externalRefs">
>;

/**
 * Writer for the TASK row. Defaults to raw `ctx.db`; the disconnect/reconnect
 * drains pass `withTriggers(ctx).db` so the task patch fires the aggregate/graph
 * triggers. The lookup reconcile always runs on raw `ctx.db` regardless — the
 * integration write paths live below the trigger boundary (the test fixtures
 * raw-insert tasks without registering the aggregate triggers), which is why
 * this is an explicit writer module and not a dbTriggers hook.
 */
type TaskWriter = Pick<MutationCtx["db"], "patch">;

/**
 * Set the single external link on an existing task: writes `[ref]` to
 * `tasks.externalRefs` and mirrors it into the lookup. `alsoPatch` is applied
 * in the same task write.
 */
export async function setTaskExternalLink(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    projectId: Id<"projects">;
    ref: TaskExternalRef;
    alsoPatch?: TaskLinkPatch;
    writer?: TaskWriter;
  },
): Promise<void> {
  const externalRefs = [args.ref];
  const writer = args.writer ?? ctx.db;
  await writer.patch(args.taskId, { ...args.alsoPatch, externalRefs });
  await reconcileTaskExternalRefs(
    ctx,
    args.taskId,
    args.projectId,
    externalRefs,
  );
}

/**
 * Insert a new task whose external link is set. Wraps `ctx.db.insert("tasks")`
 * so the ref is written AND the lookup mirrored before the new id escapes —
 * `task` is every task field EXCEPT `externalRefs`, which this module supplies
 * from `ref`. (This is the one site coupled to the full `tasks` schema; that's
 * deliberate, since task creation is exactly where forgetting the lookup would
 * be easiest.)
 */
export async function insertTaskWithExternalLink(
  ctx: MutationCtx,
  args: {
    task: Omit<WithoutSystemFields<Doc<"tasks">>, "externalRefs">;
    ref: TaskExternalRef;
  },
): Promise<Id<"tasks">> {
  const externalRefs = [args.ref];
  const taskId = await ctx.db.insert("tasks", {
    ...args.task,
    externalRefs,
  });
  await reconcileTaskExternalRefs(
    ctx,
    taskId,
    args.task.projectId,
    externalRefs,
  );
  return taskId;
}

/**
 * Clear the external link from a task: sets `tasks.externalRefs` to `undefined`
 * and empties the lookup. `alsoPatch` is applied in the same task write (e.g.
 * snapshotting the link into `externalRefFrozen` on disconnect). No `projectId`
 * is needed — clearing only deletes lookup rows, which are found `by_task`.
 */
export async function clearTaskExternalLink(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    alsoPatch?: TaskLinkPatch;
    writer?: TaskWriter;
  },
): Promise<void> {
  const writer = args.writer ?? ctx.db;
  await writer.patch(args.taskId, {
    ...args.alsoPatch,
    externalRefs: undefined,
  });
  await reconcileTaskExternalRefs(ctx, args.taskId, undefined, undefined);
}

/**
 * Mark a task's external link as deleted-upstream: flips `deleted: true` on
 * every existing ref. The repo#issue keys are unchanged, so the lookup reconcile
 * is a no-op — intentional, so a PR that closes a deleted-upstream issue can
 * still resolve the task. No-ops when the task carries no refs.
 */
export async function markTaskExternalLinkDeleted(
  ctx: MutationCtx,
  args: { taskId: Id<"tasks">; writer?: TaskWriter },
): Promise<void> {
  const task = await ctx.db.get(args.taskId);
  if (!task?.externalRefs) return;
  const writer = args.writer ?? ctx.db;
  const externalRefs = task.externalRefs.map((ref) => ({
    ...ref,
    deleted: true,
  }));
  await writer.patch(args.taskId, { externalRefs });
  await reconcileTaskExternalRefs(
    ctx,
    args.taskId,
    task.projectId,
    externalRefs,
  );
}

/**
 * Reconcile the `taskExternalRefs` lookup for a task to exactly match `refs`.
 * Idempotent: deletes rows no longer present, inserts the missing ones. Private
 * to this module by design — see the file header.
 */
async function reconcileTaskExternalRefs(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  // Only needed to insert new rows; `undefined` is valid when `refs` is empty
  // (the clear path), where the reconcile is delete-only.
  projectId: Id<"projects"> | undefined,
  refs: ReadonlyArray<{ repoFullName: string; issueNumber: number }> | undefined,
): Promise<void> {
  const existing = await ctx.db
    .query("taskExternalRefs")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();

  const want = new Map<string, { repoFullName: string; issueNumber: number }>(
    (refs ?? []).map((r) => [`${r.repoFullName}#${r.issueNumber}`, r]),
  );

  for (const row of existing) {
    const key = `${row.repoFullName}#${row.issueNumber}`;
    if (want.has(key)) {
      want.delete(key); // already present — keep it
    } else {
      await ctx.db.delete(row._id); // no longer referenced
    }
  }

  if (want.size === 0) return;
  if (projectId === undefined) {
    // Unreachable: callers passing refs always pass a projectId.
    throw new Error("reconcileTaskExternalRefs: projectId required to insert");
  }
  for (const ref of want.values()) {
    await ctx.db.insert("taskExternalRefs", {
      taskId,
      projectId,
      repoFullName: ref.repoFullName,
      issueNumber: ref.issueNumber,
    });
  }
}
