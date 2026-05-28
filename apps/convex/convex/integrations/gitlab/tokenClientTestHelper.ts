import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { getValidGitlabAccessToken } from "./tokenClient";

/**
 * Thin internal-action wrapper around `getValidGitlabAccessToken` so tests can
 * drive the seam via `t.action(...)`. Not used at runtime — production callers
 * (the outbound dispatch + register-project action) reach into the function
 * directly because they already run in an action context.
 */
export const runResolve = internalAction({
  args: { credentialRef: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    return await getValidGitlabAccessToken(ctx, args.credentialRef);
  },
});
