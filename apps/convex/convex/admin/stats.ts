import { v } from "convex/values";
import { query } from "../_generated/server";
import { requirePlatformAdmin } from "../authHelpers";

/**
 * Platform-wide counts for the admin Overview page. Guard runs first, so this
 * public query is safe. Counts use full-table `.collect()` — fine at this app's
 * scale (a single operator's deployment); revisit with @convex-dev/aggregate if
 * any table grows into the hundreds of thousands.
 *
 * `messages` is deliberately NOT among them. This is a subscribed query, so a
 * message count re-runs all of these scans on every message sent anywhere in
 * the deployment while the tab is open — and `messages` is both the fastest
 * growing table and the widest row (`body` + `plainText`), so it would be the
 * leg that pushes this query past the transaction limits and hard-fails the
 * whole page. A total message count is not worth that; per-workspace activity
 * is what an operator actually acts on. Do not add it back without an
 * aggregate or a counter — never a `.collect()`.
 */
export const overview = query({
  args: {},
  returns: v.object({
    users: v.number(),
    admins: v.number(),
    bots: v.number(),
    workspaces: v.number(),
    channels: v.number(),
    documents: v.number(),
    projects: v.number(),
    tasks: v.number(),
    pendingInvites: v.number(),
    /** Background work that gave up — see `admin/jobs.ts`. Zero is the healthy case. */
    failedJobs: v.number(),
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

    const [
      users,
      workspaces,
      channels,
      documents,
      projects,
      tasks,
      invites,
      failedJobs,
    ] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("workspaces").collect(),
      ctx.db.query("channels").collect(),
      ctx.db.query("documents").collect(),
      ctx.db.query("projects").collect(),
      ctx.db.query("tasks").collect(),
      ctx.db.query("workspaceInvites").collect(),
      ctx.db.query("backgroundJobFailures").collect(),
    ]);

    const recentSignups = [...users]
      .filter((u) => !u.isBot)
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, 6)
      .map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        createdAt: u._creationTime,
      }));

    return {
      users: users.filter((u) => !u.isBot).length,
      admins: users.filter((u) => u.isPlatformAdmin).length,
      bots: users.filter((u) => u.isBot).length,
      workspaces: workspaces.length,
      channels: channels.length,
      documents: documents.length,
      projects: projects.length,
      tasks: tasks.length,
      pendingInvites: invites.filter((i) => i.status === "pending").length,
      failedJobs: failedJobs.length,
      recentSignups,
    };
  },
});
