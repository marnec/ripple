import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelRole } from "@ripple/shared/enums/roles";
import { withTriggers } from "../convex/dbTriggers";
import { NAME_CHANGE_COOLDOWN_MS } from "@ripple/shared/constants";
import type { Id } from "../convex/_generated/dataModel";

async function joinChannel(
  t: ReturnType<typeof createTestContext>,
  opts: {
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    name?: string;
    email?: string;
    type?: "open" | "closed" | "dm";
  },
) {
  const { workspaceId, userId, name, email, type = "closed" } = opts;
  return await t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      name: "somewhere",
      workspaceId,
      type,
    });
    await ctx.db.insert("channelMembers", {
      channelId,
      workspaceId,
      userId,
      role: ChannelRole.ADMIN,
      name,
      email,
    });
    return channelId;
  });
}

/**
 * The `users` trigger refreshes `channelMembers.name`/`.email` in the SAME
 * transaction as the rename. These tests never run scheduled functions —
 * `t.finishInProgressScheduledFunctions()` is deliberately absent — so a row
 * that is correct here can only have been written inline.
 *
 * That matters most for `email`, which is not a read cache: it is the DM-dedup
 * key in `channels.createDm`, and it is the only surviving record of a user
 * who deletes their account and signs up again.
 */
describe("users trigger — channelMembers denormalization is transactional", () => {
  it("refreshes the name on every membership row without running the scheduler", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const a = await joinChannel(t, { workspaceId, userId, name: "Test User" });
    const b = await joinChannel(t, { workspaceId, userId, name: "Test User" });

    await asUser.mutation(api.users.update, { userId, name: "Renamed Person" });

    const names = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("channelMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      return rows.map((r) => r.name);
    });

    expect(names, "both rows must be current before any scheduled work runs").toEqual([
      "Renamed Person",
      "Renamed Person",
    ]);
    expect([a, b]).toHaveLength(2);
  });

  it("keeps the DM-dedup key current when the email changes", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    await joinChannel(t, { workspaceId, userId, email: "old@example.com" });

    // An email change arrives through Convex Auth's callback, not through one
    // of our mutations — so it reaches the trigger via an explicitly wrapped
    // writer. This is exactly what auth.ts does; see the comment there.
    await t.run(async (ctx) => {
      await withTriggers(ctx).db.patch(userId, { email: "new@example.com" });
    });

    const emails = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("channelMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      return rows.map((r) => r.email);
    });

    expect(
      emails,
      "a stale copy here silently breaks DM dedup for a re-signed-up user",
    ).toEqual(["new@example.com"]);
  });

  it("does not touch rows belonging to other users", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: otherId } = await setupAuthenticatedUser(t, {
      name: "Untouched",
      email: "other@example.com",
    });
    await joinChannel(t, { workspaceId, userId, name: "Test User" });
    await joinChannel(t, { workspaceId, userId: otherId, name: "Untouched" });

    await asUser.mutation(api.users.update, { userId, name: "Changed" });

    const otherName = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("channelMembers")
        .withIndex("by_user", (q) => q.eq("userId", otherId))
        .unique();
      return row?.name;
    });

    expect(otherName).toBe("Untouched");
  });
});

describe("users.update — one name change per month", () => {
  it("allows the first change", async () => {
    const t = createTestContext();
    const { userId, asUser } = await setupWorkspaceWithAdmin(t);

    await asUser.mutation(api.users.update, { userId, name: "First Name" });

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.name).toBe("First Name");
    expect(user?.nameChangedAt, "the allowance must be recorded").toBeTypeOf("number");
  });

  it("refuses a second change inside the cooldown", async () => {
    const t = createTestContext();
    const { userId, asUser } = await setupWorkspaceWithAdmin(t);

    await asUser.mutation(api.users.update, { userId, name: "First Name" });

    await expect(
      asUser.mutation(api.users.update, { userId, name: "Second Name" }),
    ).rejects.toThrow(/change your name again/);

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.name, "the refused change must not land").toBe("First Name");
  });

  it("allows another change once the cooldown has elapsed", async () => {
    const t = createTestContext();
    const { userId, asUser } = await setupWorkspaceWithAdmin(t);

    await asUser.mutation(api.users.update, { userId, name: "First Name" });
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, {
        nameChangedAt: Date.now() - NAME_CHANGE_COOLDOWN_MS - 1,
      });
    });

    await asUser.mutation(api.users.update, { userId, name: "Second Name" });

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.name).toBe("Second Name");
  });

  it("does not spend the allowance on a no-op rename", async () => {
    const t = createTestContext();
    const { userId, asUser } = await setupWorkspaceWithAdmin(t);

    // `setupWorkspaceWithAdmin` creates the user as "Test User".
    await asUser.mutation(api.users.update, { userId, name: "Test User" });

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.nameChangedAt, "submitting the current name is not a change").toBeUndefined();

    // …and a real change immediately afterwards is still allowed.
    await asUser.mutation(api.users.update, { userId, name: "A Real Change" });
    expect((await t.run((ctx) => ctx.db.get(userId)))?.name).toBe("A Real Change");
  });

  it("keeps users.viewer working after a rename", async () => {
    const t = createTestContext();
    const { userId, asUser } = await setupWorkspaceWithAdmin(t);

    await asUser.mutation(api.users.update, { userId, name: "Renamed" });

    // `users.viewer` returns the whole row against `userValidator`. A column
    // the validator does not declare fails the WHOLE query — for every caller,
    // not only the rows that carry it — so `nameChangedAt` has to be declared
    // there as well as in the schema.
    const viewer = await asUser.query(api.users.viewer, {});
    expect(viewer?.name).toBe("Renamed");
    expect(viewer?.nameChangedAt).toBeTypeOf("number");
  });

  it("refuses to rename somebody else", async () => {
    const t = createTestContext();
    const { asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: victimId } = await setupAuthenticatedUser(t, {
      name: "Victim",
      email: "victim@example.com",
    });

    await expect(
      asUser.mutation(api.users.update, { userId: victimId, name: "Hijacked" }),
    ).rejects.toThrow("Not authorized");
  });
});
