import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { WorkspaceRole, ChannelRole } from "@ripple/shared/enums";

// ─── Result types ────────────────────────────────────────────────────

export interface AuthIdentity {
  userId: Id<"users">;
}

export interface WorkspaceAuth extends AuthIdentity {
  membership: Doc<"workspaceMembers">;
}

// ─── Internal building blocks ────────────────────────────────────────

type Ctx = { db: QueryCtx["db"]; auth: QueryCtx["auth"] };

/** Raw membership lookup — no auth check, for internal queries that receive userId explicitly. */
export async function getWorkspaceMembership(
  ctx: { db: QueryCtx["db"] },
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
): Promise<Doc<"workspaceMembers"> | null> {
  return ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", userId),
    )
    .first();
}

// ─── Authentication ──────────────────────────────────────────────────

/** Returns userId or null. Thin wrapper so callers import one module. */
export async function getUser(ctx: Ctx): Promise<Id<"users"> | null> {
  return await getAuthUserId(ctx);
}

/** Authenticate + require login. Throws ConvexError if not logged in. */
export async function requireUser(ctx: Ctx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Not authenticated");
  return userId;
}

// ─── Workspace membership ────────────────────────────────────────────

/**
 * Authenticate + require workspace membership. Throws on failure.
 * Pass `opts.role` to require a specific role (e.g. WorkspaceRole.ADMIN).
 */
export async function requireWorkspaceMember(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
  opts?: { role?: typeof WorkspaceRole.ADMIN },
): Promise<WorkspaceAuth> {
  const userId = await requireUser(ctx);
  const membership = await getWorkspaceMembership(ctx, workspaceId, userId);
  if (!membership) throw new ConvexError("Not a member of this workspace");
  if (opts?.role && membership.role !== opts.role) {
    throw new ConvexError("Insufficient permissions");
  }
  return { userId, membership };
}

/**
 * Soft variant for queries — returns null instead of throwing.
 * Use when the query should return null/[] on unauthorized.
 */
export async function checkWorkspaceMember(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
): Promise<WorkspaceAuth | null> {
  const userId = await getUser(ctx);
  if (!userId) return null;
  const membership = await getWorkspaceMembership(ctx, workspaceId, userId);
  if (!membership) return null;
  return { userId, membership };
}

// ─── Resource access (fetch + membership in one step) ────────────────

/** Tables whose rows carry a workspaceId field. */
type WorkspaceResource =
  | "documents"
  | "diagrams"
  | "spreadsheets"
  | "projects"
  | "tasks"
  | "cycles";

/**
 * Authenticate + fetch resource + verify workspace membership. Throws on failure.
 * Returns the resource alongside auth result so callers don't re-fetch.
 */
export async function requireResourceMember<T extends WorkspaceResource>(
  ctx: Ctx,
  table: T,
  resourceId: Id<T>,
  opts?: { role?: typeof WorkspaceRole.ADMIN },
): Promise<{ userId: Id<"users">; resource: Doc<T>; membership: Doc<"workspaceMembers"> }> {
  const userId = await requireUser(ctx);

  const resource = await ctx.db.get(resourceId);
  if (!resource) {
    throw new ConvexError(`${table.slice(0, -1)} not found`);
  }

  const workspaceId = (resource as unknown as { workspaceId: Id<"workspaces"> }).workspaceId;
  const membership = await getWorkspaceMembership(ctx, workspaceId, userId);
  if (!membership) throw new ConvexError("Not a member of this workspace");
  if (opts?.role && membership.role !== opts.role) {
    throw new ConvexError("Insufficient permissions");
  }

  return { userId, resource: resource, membership };
}

/**
 * Soft variant — returns null if resource missing or user not a member.
 * For queries that should return null/[] on unauthorized.
 */
export async function checkResourceMember<T extends WorkspaceResource>(
  ctx: Ctx,
  table: T,
  resourceId: Id<T>,
): Promise<{ userId: Id<"users">; resource: Doc<T>; membership: Doc<"workspaceMembers"> } | null> {
  const userId = await getUser(ctx);
  if (!userId) return null;

  const resource = await ctx.db.get(resourceId);
  if (!resource) return null;

  const workspaceId = (resource as unknown as { workspaceId: Id<"workspaces"> }).workspaceId;
  const membership = await getWorkspaceMembership(ctx, workspaceId, userId);
  if (!membership) return null;

  return { userId, resource: resource, membership };
}

// ─── Channel access ──────────────────────────────────────────────────

/**
 * Channel access with open/closed/dm branching.
 * Pass `opts.role` to require admin:
 *   - Closed/DM channel: requires ChannelRole.ADMIN in channelMembers
 *   - Open channel: requires WorkspaceRole.ADMIN in workspaceMembers
 */
export async function requireChannelAccess(
  ctx: Ctx,
  channelId: Id<"channels">,
  opts?: { role?: typeof ChannelRole.ADMIN },
): Promise<{
  userId: Id<"users">;
  channel: Doc<"channels">;
  workspaceMembership: Doc<"workspaceMembers">;
  channelMembership: Doc<"channelMembers"> | null;
}> {
  const userId = await requireUser(ctx);

  const channel = await ctx.db.get(channelId);
  if (!channel) throw new ConvexError("Channel not found");

  const workspaceMembership = await getWorkspaceMembership(ctx, channel.workspaceId, userId);
  if (!workspaceMembership) throw new ConvexError("Not a member of this workspace");

  let channelMembership: Doc<"channelMembers"> | null = null;

  if (channel.type !== "open") {
    channelMembership = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channelId).eq("userId", userId),
      )
      .first();

    if (!channelMembership) throw new ConvexError("Not a member of this channel");

    if (opts?.role && channelMembership.role !== opts.role) {
      throw new ConvexError("Not authorized");
    }
  } else if (opts?.role) {
    if (workspaceMembership.role !== WorkspaceRole.ADMIN) {
      throw new ConvexError("Not authorized");
    }
  }

  return { userId, channel, workspaceMembership, channelMembership };
}

// ─── Creator-only ────────────────────────────────────────────────────

/** Verify the authenticated user is the creator of a resource. Throws on mismatch. */
export function requireCreator(
  resource: { creatorId: Id<"users"> },
  userId: Id<"users">,
): void {
  if (resource.creatorId !== userId) {
    throw new ConvexError("Only the creator can perform this action");
  }
}

// ─── Collaboration access (unified) ─────────────────────────────────

/**
 * Single function replacing the 5 near-identical collaboration check queries.
 * For use inside internalQuery handlers where userId is passed explicitly.
 */
export async function hasResourceAccess(
  ctx: { db: QueryCtx["db"] },
  userId: Id<"users">,
  resourceType: "doc" | "diagram" | "task" | "spreadsheet" | "presence",
  resourceId: string,
): Promise<boolean> {
  if (resourceType === "presence") {
    const member = await getWorkspaceMembership(
      ctx,
      resourceId as Id<"workspaces">,
      userId,
    );
    return member !== null;
  }

  const _tableMap = {
    doc: "documents",
    diagram: "diagrams",
    task: "tasks",
    spreadsheet: "spreadsheets",
  } as const;

  const resource = await ctx.db.get(resourceId as Id<(typeof _tableMap)[typeof resourceType]>);
  if (!resource) return false;

  const workspaceId = (resource as unknown as { workspaceId: Id<"workspaces"> }).workspaceId;
  const member = await getWorkspaceMembership(ctx, workspaceId, userId);
  return member !== null;
}

