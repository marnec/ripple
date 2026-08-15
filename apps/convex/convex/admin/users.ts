import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Id } from "../_generated/dataModel";
import { query, type MutationCtx } from "../_generated/server";
import { mutation } from "../functions";
import { auditLog } from "../auditLog";
import { requirePlatformAdmin } from "../authHelpers";
import { removeMembershipCascade } from "../workspaceMembers";

/**
 * Admin-only: users newest-first with denormalized identity + reach (auth
 * providers, how many workspaces they're in). The guard is the first line, so
 * this is safe as a public `query` reachable from any origin.
 *
 * Paginated off the creation-time index, so the read set is one page. The
 * previous shape read `users`, `authAccounts` and `workspaceMembers` whole and
 * joined them in memory — cheaper *per user* than the N+1 it replaced, but
 * unbounded in the deployment, and held open as a live subscription by the
 * console's user list. The per-row lookups below are the N+1 again, on purpose:
 * bounded to a page and index-driven, that is the trade pagination buys.
 *
 * There is no server-side search behind this. The console's search box filters
 * the pages already loaded, which is a real limitation — `users` carries no
 * search index, and adding one is the prerequisite for making that box
 * authoritative.
 */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(
      v.object({
        _id: v.id("users"),
        createdAt: v.number(),
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        image: v.optional(v.string()),
        emailVerified: v.boolean(),
        isPlatformAdmin: v.boolean(),
        isBot: v.boolean(),
        isAnonymous: v.boolean(),
        disabled: v.boolean(),
        providers: v.array(v.string()),
        workspaceCount: v.number(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { paginationOpts }) => {
    await requirePlatformAdmin(ctx);

    const result = await ctx.db.query("users").order("desc").paginate(paginationOpts);

    const page = await Promise.all(
      result.page.map(async (u) => {
        const [accounts, memberships] = await Promise.all([
          ctx.db
            .query("authAccounts")
            .withIndex("userIdAndProvider", (q) => q.eq("userId", u._id))
            .collect(),
          ctx.db
            .query("workspaceMembers")
            .withIndex("by_user", (q) => q.eq("userId", u._id))
            .collect(),
        ]);
        return {
          _id: u._id,
          createdAt: u._creationTime,
          name: u.name,
          email: u.email,
          image: u.image,
          emailVerified: u.emailVerificationTime !== undefined,
          isPlatformAdmin: Boolean(u.isPlatformAdmin),
          isBot: Boolean(u.isBot),
          isAnonymous: Boolean(u.isAnonymous),
          disabled: Boolean(u.disabled),
          providers: accounts.map((a) => a.provider),
          workspaceCount: memberships.length,
        };
      }),
    );

    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/** Admin-only: one user with the workspaces they belong to and their role. */
export const get = query({
  args: { userId: v.id("users") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("users"),
      createdAt: v.number(),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      image: v.optional(v.string()),
      emailVerified: v.boolean(),
      isPlatformAdmin: v.boolean(),
      isBot: v.boolean(),
      isAnonymous: v.boolean(),
      disabled: v.boolean(),
      githubLogin: v.optional(v.string()),
      gitlabLogin: v.optional(v.string()),
      providers: v.array(v.string()),
      workspaces: v.array(
        v.object({
          _id: v.id("workspaces"),
          name: v.string(),
          role: v.string(),
          isOwner: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { userId }) => {
    await requirePlatformAdmin(ctx);

    const user = await ctx.db.get(userId);
    if (!user) return null;

    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect();

    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const workspaces = (
      await Promise.all(
        memberships.map(async (m) => {
          const ws = await ctx.db.get(m.workspaceId);
          if (!ws) return null;
          return {
            _id: ws._id,
            name: ws.name,
            role: m.role,
            isOwner: ws.ownerId === userId,
          };
        }),
      )
    ).filter((w): w is NonNullable<typeof w> => w !== null);

    return {
      _id: user._id,
      createdAt: user._creationTime,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerificationTime !== undefined,
      isPlatformAdmin: Boolean(user.isPlatformAdmin),
      isBot: Boolean(user.isBot),
      isAnonymous: Boolean(user.isAnonymous),
      disabled: Boolean(user.disabled),
      githubLogin: user.githubLogin,
      gitlabLogin: user.gitlabLogin,
      providers: accounts.map((a) => a.provider),
      workspaces,
    };
  },
});

/**
 * Grant or revoke platform-admin. Guarded — and you cannot revoke your own
 * flag, which prevents the only obvious lock-out (an admin demoting the
 * account they're currently using). Promoting others / revoking other admins
 * is allowed.
 */
export const setPlatformAdmin = mutation({
  args: { userId: v.id("users"), value: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { userId, value }) => {
    const callerId = await requirePlatformAdmin(ctx);

    if (callerId === userId && value === false) {
      throw new ConvexError(
        "You can't revoke your own admin access (lock-out guard).",
      );
    }

    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found");
    if (user.isBot) throw new ConvexError("Bots can't be platform admins");

    await ctx.db.patch(userId, { isPlatformAdmin: value });
    return null;
  },
});

/**
 * Deactivate or reactivate an account (reversible). Disabling sets the flag
 * (rejected by `auth.ts` beforeSessionCreation on any new sign-in) and deletes
 * the user's sessions + refresh tokens, so they can't mint new tokens. NOTE: an
 * already-issued access JWT stays valid until it expires (~1h) — Convex
 * validates JWTs statelessly — so this is not instant revocation. Sensitive
 * surfaces re-check `disabled` per request (see `requirePlatformAdmin`). You
 * can't disable yourself (lock-out guard). Content is preserved either way.
 */
export const setDisabled = mutation({
  args: { userId: v.id("users"), value: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { userId, value }) => {
    const callerId = await requirePlatformAdmin(ctx);

    if (callerId === userId && value === true) {
      throw new ConvexError("You can't disable your own account.");
    }

    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found");

    await ctx.db.patch(userId, { disabled: value });
    if (value) await clearSessions(ctx, userId);

    await auditLog.log(ctx, {
      action: value ? "users.disabled" : "users.reactivated",
      actorId: callerId,
      resourceType: "users",
      resourceId: userId,
      severity: "warning",
    });
    return null;
  },
});

/**
 * Irreversibly delete a user account: removes every workspace membership
 * (reusing removeMembershipCascade — same DM/admin-reassign cascade as a normal
 * removal), clears all auth rows (sessions, refresh tokens, accounts,
 * verification codes), then deletes the user. Authored content (tasks, docs,
 * messages) is intentionally preserved and will render as an unknown author —
 * matching the app's member-removal policy.
 *
 * Refuses if the user still OWNS workspaces (would orphan `ownerId`); the admin
 * must delete or reassign those first. Can't delete yourself.
 */
export const deleteAccount = mutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const callerId = await requirePlatformAdmin(ctx);
    if (callerId === userId) throw new ConvexError("You can't delete your own account.");

    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found");

    // Block if the user owns any workspace — deleting them would dangle ownerId.
    const ownedWorkspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    if (ownedWorkspaces.length > 0) {
      const names = ownedWorkspaces.map((w) => w.name).join(", ");
      throw new ConvexError(
        `User owns ${ownedWorkspaces.length} workspace(s) (${names}). Delete or transfer them first.`,
      );
    }

    // Remove from every workspace via the shared cascade.
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const m of memberships) {
      await removeMembershipCascade(ctx, {
        workspaceId: m.workspaceId,
        targetUserId: userId,
        actingUserId: callerId,
      });
    }

    await clearSessions(ctx, userId);
    await clearAccounts(ctx, userId);

    await auditLog.log(ctx, {
      action: "users.deleted",
      actorId: callerId,
      resourceType: "users",
      resourceId: userId,
      severity: "warning",
      metadata: { email: user.email ?? null, name: user.name ?? null },
    });

    await ctx.db.delete(userId);
    return null;
  },
});

// ── Auth-row cleanup (replicates @convex-dev/auth's invalidateSessions, which
//    is action-only, plus account removal — all index-driven, no table scans) ──

async function clearSessions(ctx: MutationCtx, userId: Id<"users">) {
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  for (const session of sessions) {
    const refreshTokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const t of refreshTokens) await ctx.db.delete(t._id);
    await ctx.db.delete(session._id);
  }
}

async function clearAccounts(ctx: MutationCtx, userId: Id<"users">) {
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .collect();
  for (const account of accounts) {
    const codes = await ctx.db
      .query("authVerificationCodes")
      .withIndex("accountId", (q) => q.eq("accountId", account._id))
      .collect();
    for (const c of codes) await ctx.db.delete(c._id);
    await ctx.db.delete(account._id);
  }
}
