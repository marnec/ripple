import { query } from "./_generated/server";
import { mutation } from "./functions";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { publicUserValidator, userValidator } from "./validators";
import { getUser, requireUser } from "./authHelpers";
import { nameChangeAvailableAt } from "@ripple/shared/constants";

export const viewer = query({
  args: {},
  returns: v.union(userValidator, v.null()),
  handler: async (ctx) => {
    const userId = await getUser(ctx);

    if (!userId) return null;

    return ctx.db.get(userId);
  },
});

/** Project a user row down to the fields any signed-in caller may see. */
function toPublicUser(user: Doc<"users">) {
  return {
    _id: user._id,
    _creationTime: user._creationTime,
    name: user.name,
    image: user.image,
    isBot: user.isBot,
  };
}

/**
 * Id-addressable, so it is not scoped to any workspace — which is exactly why
 * it must not return the full row. It used to return the whole
 * `userValidator`, including `email`, `disabled` and **`isPlatformAdmin`**,
 * which is an account-takeover targeting list.
 *
 * Deliberately NOT gated on `requireUser`: unauthenticated guests on
 * `/share/:shareId` are not Convex-authenticated (see `Share/guestSession.ts`
 * — `guestSub` is a per-tab string, not an identity), and the shared document
 * schema includes the user-mention block, which resolves authors through this
 * query. Adding an auth check here breaks mention rendering on every shared
 * document. The projection, not the gate, is what carries the security value:
 * holding an opaque user id yields a display name and an avatar, which is
 * precisely what a document you were given access to needs to render.
 */
export const get = query({
  args: { id: v.id("users") },
  returns: v.union(publicUserValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.id);
    return user ? toPublicUser(user) : null;
  },
});

/**
 * Change the caller's display name — at most once every
 * `NAME_CHANGE_COOLDOWN_MS` (30 days).
 *
 * The cooldown is a cost control, not a policy: a rename fans out through the
 * `users` trigger to the caller's `nodes` row and to every `channelMembers`
 * row they hold, all inside this transaction. Without a limit that fan-out is
 * repeatable at will.
 *
 * A no-op rename does not spend the allowance. Submitting the name you already
 * have is not a change, and burning a month on it would be indefensible.
 */
export const update = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, name }) => {
    const currentUserId = await requireUser(ctx);
    if (currentUserId !== userId) throw new ConvexError("Not authorized to update this user");

    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found");

    // No-op: nothing fans out, so nothing is spent and nothing is blocked.
    if (user.name === name) return null;

    const availableAt = nameChangeAvailableAt(user.nameChangedAt);
    if (availableAt !== null) {
      throw new ConvexError(
        `You can change your name again on ${new Date(availableAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`,
      );
    }

    await ctx.db.patch(userId, {
      name,
      nameChangedAt: Date.now(),
    });
    return null;
  },
});

export const getByIds = query({
  args: { ids: v.array(v.id("users")) },
  returns: v.record(v.id("users"), publicUserValidator),
  handler: async (ctx, { ids }) => {
    // Same reasoning as `get` above — reachable by guests resolving comment
    // authors in a shared document (`use-document-collaboration.ts`).
    if (ids.length === 0) {
      return {};
    }
    const users = await Promise.all(ids.map((id) => ctx.db.get(id)));
    const userMap: Record<Id<"users">, ReturnType<typeof toPublicUser>> = {};
    users
      .filter((u): u is Doc<"users"> => u !== null)
      .forEach((user) => {
        userMap[user._id] = toPublicUser(user);
      });
    return userMap;
  },
});
