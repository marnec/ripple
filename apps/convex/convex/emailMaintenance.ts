/**
 * Retention for the `@convex-dev/resend` component's own tables.
 *
 * The component stores every email it has handled, rendered `html` included,
 * and schedules **no** cleanup of its own — it exposes the two cleanup
 * mutations and leaves the policy to the app. So without this cron the
 * component's tables grow forever, and the bodies (event titles and
 * descriptions, once calendar mail moves over in T6 phase 2) sit at rest
 * indefinitely.
 *
 * Two windows, because the component distinguishes two ways an email stops
 * being interesting:
 *  - **finalized** — delivered, bounced, cancelled: a terminal webhook arrived;
 *  - **abandoned** — never finalized at all, because no webhook ever came for
 *    it (the endpoint was down, or the deployment predates the webhook). These
 *    need a longer window: a delayed delivery event is still worth applying.
 */

import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation } from "./functions";

/** Matches the component's own defaults, restated so the policy is readable here. */
const FINALIZED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ABANDONED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const pruneEmailRecords = internalMutation({
  args: {
    finalizedOlderThanMs: v.optional(v.number()),
    abandonedOlderThanMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Both component mutations page themselves — each re-schedules while a full
    // batch comes back — so this stays one call per window regardless of backlog.
    await ctx.runMutation(components.resend.lib.cleanupOldEmails, {
      olderThan: args.finalizedOlderThanMs ?? FINALIZED_RETENTION_MS,
    });
    await ctx.runMutation(components.resend.lib.cleanupAbandonedEmails, {
      olderThan: args.abandonedOlderThanMs ?? ABANDONED_RETENTION_MS,
    });
    return null;
  },
});
