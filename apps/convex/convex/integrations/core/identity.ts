import type { QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/**
 * Two-layer mapping between a provider-side identity and a Ripple workspace
 * member. Provider-neutral: a `provider` arg selects the namespace.
 *
 * The matcher resolves in this order:
 *
 *  1. `workspaceMemberExternalIdentity` — the provider-generic, per-workspace
 *     override. Empty in the common case today, but it's the home for explicit
 *     "this member is `@x` on <provider> here" links and for non-OAuth
 *     identities. Keyed off the same `provider` field for every provider.
 *  2. `users.githubLogin` — captured at GitHub OAuth sign-in (see auth.ts), then
 *     confirmed to be a member of the workspace. This is what makes the
 *     "same GitHub account on both sides" case resolve with no manual linking.
 *     GitHub-only: other providers have no equivalent OAuth-captured column, so
 *     layer 2 is skipped for them and they rely entirely on layer 1.
 *
 * Both directions check (1) then (2) so the override always wins.
 */

const GITHUB = "github";

/**
 * Resolve a provider login to the workspace member it belongs to, or undefined.
 * `provider` namespaces the override lookup; the OAuth-captured fallback only
 * applies to GitHub.
 */
export async function externalLoginToMember(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  provider: string,
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
        .eq("provider", provider)
        .eq("externalLogin", canonical),
    )
    .unique();
  if (override) return override.userId;

  // (2) OAuth-captured login on the user row, scoped to this workspace's members.
  // GitHub-only — other providers have no equivalent captured column.
  if (provider !== GITHUB) return undefined;

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

/**
 * Resolve a provider-side numeric user id to the workspace member it belongs
 * to, or undefined. Override-table only — there is no OAuth-captured user-id
 * column, so this has no layer 2. Used by providers that address identities by
 * id rather than login (e.g. GitLab `assignee_ids` / `author.id`).
 */
export async function externalUserIdToMember(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  provider: string,
  externalUserId: string,
): Promise<Id<"users"> | undefined> {
  if (externalUserId.length === 0) return undefined;
  const override = await ctx.db
    .query("workspaceMemberExternalIdentity")
    .withIndex("by_workspace_provider_userId", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("provider", provider)
        .eq("externalUserId", externalUserId),
    )
    .unique();
  return override?.userId;
}

/**
 * Resolve a workspace member to their provider-side numeric user id, or
 * undefined. Override-table only (the inverse of `externalUserIdToMember`) —
 * used for outbound assignment to providers that assign by id rather than login
 * (e.g. GitLab `assignee_ids`).
 */
export async function memberToExternalUserId(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
  provider: string,
): Promise<string | undefined> {
  const override = await ctx.db
    .query("workspaceMemberExternalIdentity")
    .withIndex("by_workspace_user_provider", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("userId", userId)
        .eq("provider", provider),
    )
    .unique();
  return override?.externalUserId ?? undefined;
}

/**
 * Resolve a workspace member to their provider login, or undefined. The
 * OAuth-captured fallback only applies to GitHub.
 */
export async function memberToExternalLogin(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
  provider: string,
): Promise<string | undefined> {
  // (1) Per-workspace override.
  const override = await ctx.db
    .query("workspaceMemberExternalIdentity")
    .withIndex("by_workspace_user_provider", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("userId", userId)
        .eq("provider", provider),
    )
    .unique();
  if (override) return override.externalLogin;

  // (2) OAuth-captured login on the user row — GitHub-only.
  if (provider !== GITHUB) return undefined;
  const user = await ctx.db.get(userId);
  return user?.githubLogin ?? undefined;
}
