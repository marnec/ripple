import { v } from "convex/values";
import { query } from "../_generated/server";
import { checkPlatformAdmin } from "../authHelpers";

/**
 * Cheap gating query for the admin frontend (apps/admin). Returns whether the
 * signed-in user is a platform admin so the UI can render the app shell vs. a
 * "not authorized" screen. This is NOT the security boundary — every admin
 * data function re-checks via `requirePlatformAdmin`. Returns false (not an
 * error) when unauthenticated so the login screen can render cleanly.
 */
export const amIAdmin = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    return await checkPlatformAdmin(ctx);
  },
});
