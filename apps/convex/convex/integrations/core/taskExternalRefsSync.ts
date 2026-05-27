import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/**
 * Reconcile the `taskExternalRefs` lookup for a task to exactly match the given
 * external refs. `taskExternalRefs` is a denormalized projection of
 * `tasks.externalRefs` that exists so the PR-sync reconciler
 * (syncInPullRequests.resolveTaskIds) can resolve an issue number to a task via
 * an index lookup instead of scanning every task in the project on each
 * pull_request webhook — the issue number lives in a nested array and can't be
 * indexed on `tasks` itself.
 *
 * Maintained explicitly (not via a dbTriggers hook) because the integration
 * write paths run below the trigger boundary: they write `tasks.externalRefs`
 * with raw `ctx.db`, and wrapping them in `withTriggers` just to fire a lookup
 * trigger would also fire the aggregate triggers, which the integration test
 * fixtures (raw-insert projects/tasks) aren't registered with. So every site
 * that writes `tasks.externalRefs` calls this right after. Task deletion is
 * handled by cascadeDelete (the table is registered there).
 *
 * Idempotent: deletes rows no longer present and inserts the missing ones, so
 * it's safe to call after any externalRefs write (set, clear, or rehydrate).
 */
export async function reconcileTaskExternalRefs(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  projectId: Id<"projects">,
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

  for (const ref of want.values()) {
    await ctx.db.insert("taskExternalRefs", {
      taskId,
      projectId,
      repoFullName: ref.repoFullName,
      issueNumber: ref.issueNumber,
    });
  }
}
