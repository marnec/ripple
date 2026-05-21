import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requireResourceMember } from "../../authHelpers";

/**
 * Pull/merge requests attached to a task, read only by the task-detail
 * surface. A task can have several PRs (and a PR several tasks) — see the
 * `taskPullRequestLinks` join. Kept off `tasks.get` so kanban subscriptions
 * stay clear of webhook-driven PR churn.
 */
export const listByTask = query({
  args: { taskId: v.id("tasks") },
  returns: v.array(
    v.object({
      number: v.number(),
      title: v.string(),
      url: v.string(),
      state: v.union(
        v.literal("draft"),
        v.literal("open"),
        v.literal("merged"),
        v.literal("closed"),
      ),
      headRef: v.string(),
      baseRef: v.string(),
      externalAuthor: v.object({
        login: v.string(),
        avatarUrl: v.string(),
        url: v.string(),
      }),
    }),
  ),
  handler: async (ctx, { taskId }) => {
    // Auth via the task — readers must be workspace members. Same gate
    // `tasks.get` uses.
    await requireResourceMember(ctx, "tasks", taskId);

    const joins = await ctx.db
      .query("taskPullRequestLinks")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();

    const prs = await Promise.all(
      joins.map((j) => ctx.db.get(j.pullRequestId)),
    );

    return prs
      .filter((pr): pr is NonNullable<typeof pr> => pr !== null)
      .sort((a, b) => a.number - b.number)
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        state: pr.state,
        headRef: pr.headRef,
        baseRef: pr.baseRef,
        externalAuthor: pr.externalAuthor,
      }));
  },
});
