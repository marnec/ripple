import { query } from "./_generated/server";
import { mutation } from "./functions";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { publicUserValidator, userValidator } from "./validators";
import { getUser, requireUser } from "./authHelpers";

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

export const update = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, name }) => {
    const currentUserId = await requireUser(ctx);
    if (currentUserId !== userId) throw new ConvexError("Not authorized to update this user");

    await ctx.db.patch(userId, {
      name,
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
