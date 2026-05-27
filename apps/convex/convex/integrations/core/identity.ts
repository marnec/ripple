import type { QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/**
 * Two-layer mapping between a GitHub login and a Ripple workspace member.
 *
 * The matcher resolves in this order:
 *
 *  1. `workspaceMemberExternalIdentity` — the provider-generic, per-workspace
 *     override. Empty in the common case today, but it's the home for explicit
 *     "this member is `@x` on GitHub here" links, for non-OAuth identities, and
 *     for future providers (GitLab, …) which key off the same `provider` field.
 *  2. `users.githubLogin` — captured at GitHub OAuth sign-in (see auth.ts), then
 *     confirmed to be a member of the workspace. This is what makes the
 *     "same GitHub account on both sides" case resolve with no manual linking.
 *
 * Both directions check (1) then (2) so the override always wins.
 */

const GITHUB = "github";

/** Resolve a GitHub login to the workspace member it belongs to, or undefined. */
export async function githubLoginToMember(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  login: string,
): Promise<Id<"users"> | undefined> {
  const canonical = login.trim().toLowerCase();
  if (canonical.length === 0) return undefined;

  // (1) Per-workspace override.
  const override = await ctx.db
    .query("workspaceMemberExternalIdentity")
    .withIndex("by_workspace_provider_login", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("provider", GITHUB)
        .eq("externalLogin", canonical),
    )
    .unique();
  if (override) return override.userId;

  // (2) OAuth-captured login on the user row, scoped to this workspace's members.
  // A GitHub login is globally unique, so at most one user carries it; `.take(2)`
  // is defensive against a stale duplicate rather than expected.
  const users = await ctx.db
    .query("users")
    .withIndex("by_github_login", (q) => q.eq("githubLogin", canonical))
    .take(2);
  if (users.length !== 1) return undefined;

  const membership = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", users[0]._id),
    )
    .unique();
  return membership ? users[0]._id : undefined;
}

/** Resolve a workspace member to their GitHub login, or undefined. */
export async function memberToGithubLogin(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
): Promise<string | undefined> {
  // (1) Per-workspace override.
  const override = await ctx.db
    .query("workspaceMemberExternalIdentity")
    .withIndex("by_workspace_user_provider", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("userId", userId)
        .eq("provider", GITHUB),
    )
    .unique();
  if (override) return override.externalLogin;

  // (2) OAuth-captured login on the user row.
  const user = await ctx.db.get(userId);
  return user?.githubLogin ?? undefined;
}
