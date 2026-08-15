import { v } from "convex/values";
import { query } from "../_generated/server";
import { requirePlatformAdmin } from "../authHelpers";

/** Read at most this many failure rows; the tile shows "N+" once saturated. */
const FAILED_JOBS_CEILING = 50;
/** Over-read signups so bot rows can be dropped without a second query. */
const SIGNUP_SCAN = 24;
const SIGNUPS_SHOWN = 6;

/**
 * The admin Overview page. Guard runs first, so this public query is safe.
 *
 * This used to return platform-wide totals — users, workspaces, channels,
 * documents, projects, tasks, pending invites — and every one of them was a
 * full-table `.collect()`. That is not a shape that can be fixed in place: the
 * per-workspace aggregates in `dbTriggers.ts` are namespaced by `workspaceId`,
 * so `.count()` requires a namespace and there is no cross-namespace total to
 * read. The counts are gone rather than made slow-but-careful, because this is
 * a *subscribed* query: every one of those scans re-ran on every write anywhere
 * in the deployment while an operator had the tab open, and the widest of them
 * would eventually trip the transaction read limits and blank the whole page.
 * Re-introducing them means adding un-namespaced aggregates first.
 *
 * What is left is what can be read under a hard bound:
 *
 * - `recentSignups` — a bounded `.take()` off the creation-time index, not a
 *   sort over every user.
 * - `failedJobs` — the console's only passive health signal, and the one table
 *   whose healthy size is zero. Capped at {@link FAILED_JOBS_CEILING}: past that
 *   the exact number tells an operator nothing the "+" doesn't.
 *
 * Do not add a count back here without an aggregate or a counter behind it —
 * never a `.collect()`.
 */
export const overview = query({
  args: {},
  returns: v.object({
    /** Background work that gave up — see `admin/jobs.ts`. Zero is the healthy case. */
    failedJobs: v.number(),
    /** `failedJobs` hit the read ceiling; render it as "N+". */
    failedJobsCapped: v.boolean(),
    recentSignups: v.array(
      v.object({
        _id: v.id("users"),
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        createdAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);

    const [newestUsers, failures] = await Promise.all([
      ctx.db.query("users").order("desc").take(SIGNUP_SCAN),
      ctx.db.query("backgroundJobFailures").take(FAILED_JOBS_CEILING + 1),
    ]);

    return {
      failedJobs: Math.min(failures.length, FAILED_JOBS_CEILING),
      failedJobsCapped: failures.length > FAILED_JOBS_CEILING,
      // Bots are created alongside integrations, so they can crowd the window;
      // over-reading absorbs that. A deployment whose newest SIGNUP_SCAN users
      // are all bots shows fewer than SIGNUPS_SHOWN rows, which is honest.
      recentSignups: newestUsers
        .filter((u) => !u.isBot)
        .slice(0, SIGNUPS_SHOWN)
        .map((u) => ({
          _id: u._id,
          name: u.name,
          email: u.email,
          createdAt: u._creationTime,
        })),
    };
  },
});
