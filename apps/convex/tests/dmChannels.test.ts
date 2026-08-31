import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "../convex/dbTriggers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("channels.createDm", () => {
  it("creates a DM between two workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, { name: "Member", email: "member@test.com" });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    const channelId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });

    expect(channelId).toBeDefined();

    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.kind).toBe("dm");
    // The row carries no rendered label. It used to store a sorted
    // `<A> × <B>` snapshot to feed `channels.searchIndex("by_name")`, which
    // then needed a rename fan-out to stay fresh. A DM is no longer
    // workspace-wide discoverable, so the label is derived where it is shown
    // (`lib/dmLabel.ts`) and there is nothing to keep in sync.
    expect(channel?.name).toBe("");
  });

  it("deduplicates DMs — second call returns the same channel", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, { name: "Member", email: "member@test.com" });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    const firstId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });

    const secondId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });

    expect(firstId).toBe(secondId);
  });

  it("cannot create a DM with yourself", async () => {
    const t = createTestContext();
    const { userId: adminId, workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);

    await expect(
      asAdmin.mutation(api.channels.createDm, {
        workspaceId,
        otherUserId: adminId,
      }),
    ).rejects.toThrow("Cannot create a DM with yourself");
  });

  it("cannot rename a DM", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, { name: "Member", email: "member@test.com" });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    const channelId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });

    await expect(
      asAdmin.mutation(api.channels.update, {
        id: channelId,
        name: "new name",
      }),
    ).rejects.toThrow("Cannot rename a DM");
  });

  it("cannot add members to a DM", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: member1Id } = await setupAuthenticatedUser(t, { name: "Member1", email: "m1@test.com" });
    const { userId: member2Id } = await setupAuthenticatedUser(t, { name: "Member2", email: "m2@test.com" });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: member1Id,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
      await ctx.db.insert("workspaceMembers", {
        userId: member2Id,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    const channelId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: member1Id,
    });

    await expect(
      asAdmin.mutation(api.channelMembers.addToChannel, {
        channelId,
        userId: member2Id,
      }),
    ).rejects.toThrow("Cannot add members to a DM");
  });

  it("getAccessInfo names the participants to a non-member (dm existence is public)", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: member1Id } = await setupAuthenticatedUser(t, { name: "Member1", email: "m1@test.com" });
    const { userId: outsiderId, asUser: asOutsider } = await setupAuthenticatedUser(t, { name: "Outsider", email: "out@test.com" });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: member1Id,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
      await ctx.db.insert("workspaceMembers", {
        userId: outsiderId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    // Admin and member1 have a DM; outsider is not in it
    const dmId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: member1Id,
    });

    // The outsider gets the rendered label, not the roster — one renderer, so
    // the gate cannot invent its own join word or ordering. Sorted, which is
    // what makes both participants read the same string.
    const outsiderAccess = await asOutsider.query(api.channels.getAccessInfo, {
      channelId: dmId,
    });
    expect(outsiderAccess).not.toBeNull();
    expect(outsiderAccess).toMatchObject({ isMember: false, type: "dm" });
    if (outsiderAccess && !outsiderAccess.isMember && outsiderAccess.type === "dm") {
      expect(outsiderAccess.label).toBe("Member1 × Test User");
    }

    // Admin (a member of the DM) should get { isMember: true }
    const adminAccess = await asAdmin.query(api.channels.getAccessInfo, {
      channelId: dmId,
    });
    expect(adminAccess).toEqual({ isMember: true });
  });

  it("needs no propagation when a participant's display name changes", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, {
      name: "Alice",
      email: "alice@test.com",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    const dmId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });

    const beforeRename = await t.run(async (ctx) => ctx.db.get(dmId));
    expect(beforeRename?.name).toBe("");

    // Rename Alice via writerWithTriggers so the users trigger fires and
    // schedules the sync mutation.
    await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.patch(memberId, { name: "Zelda" });
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Nothing was propagated, because nothing is stored. What the user sees
    // is asserted where it is produced — see `tests/dmLabel.test.ts`, which
    // checks the sidebar reflects the rename with no scheduled work at all.
    const afterRename = await t.run(async (ctx) => ctx.db.get(dmId));
    expect(afterRename?.name).toBe("");

    // This used to assert that the DM's `nodes` mirror was renamed alongside
    // it. A DM now has no node at all: `nodes` is a workspace-wide index, and
    // every reader of it is scoped to the workspace rather than to the
    // conversation, so a label that names both participants does not belong
    // there. See `tests/dmDiscovery.access.test.ts`.
    const dmNode = await t.run(async (ctx) =>
      ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", dmId))
        .first(),
    );
    expect(dmNode, "a DM is not mirrored into the workspace-wide node index").toBeNull();
  });

  // The DM guard used to sit inside `removeFromChannel`'s `!isSelfRemoval`
  // branch, so a participant could remove themselves through the public
  // mutation even though the UI never offers it. The DM was then a one-person
  // row: its label renders "Unknown", `createDm` mints a second DM for the
  // same pair rather than resolving back to it, and the leaver has no way in
  // — `addToChannel` refuses a DM.
  it("a participant cannot remove themselves from a DM", async () => {
    const t = createTestContext();
    const { userId: adminId, workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, { name: "Member", email: "leaver@test.com" });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    const channelId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });

    await expect(
      asAdmin.mutation(api.channelMembers.removeFromChannel, {
        userId: adminId,
        channelId,
      }),
    ).rejects.toThrow("Cannot remove members from a DM");

    const members = await t.run(async (ctx) =>
      ctx.db
        .query("channelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    expect(members, "the DM still holds exactly two participants").toHaveLength(2);
  });
});

// A test here used to assert that `channels.create` refuses `type: "dm"`. The
// mutation's argument is now a *visibility*, so a direct message is not
// something the call can express at all — the guarantee moved from a runtime
// rejection to the type system. What it protected is covered by
// `channelKindVisibility.test.ts`, which asserts the mutation always writes
// `kind: "channel"`.

/**
 * The read behind "click a name to message them": opening a conversation that
 * exists is one thing, putting a new one in someone else's sidebar is another,
 * and the chip has to tell them apart before it acts.
 */
describe("channels.findDmWith", () => {
  it("is null until the conversation exists, then names it", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, {
      name: "Member",
      email: "member@test.com",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    expect(
      await asAdmin.query(api.channels.findDmWith, { workspaceId, otherUserId: memberId }),
    ).toBeNull();

    const channelId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: memberId,
    });

    expect(
      await asAdmin.query(api.channels.findDmWith, { workspaceId, otherUserId: memberId }),
    ).toBe(channelId);
  });

  it("reads null for yourself rather than throwing, unlike createDm", async () => {
    const t = createTestContext();
    const { userId: adminId, workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);

    // `createDm` refuses because there is nothing sane to create. Asking
    // whether one exists has an honest answer, and it is "no" — a caller that
    // threw here would make every self-mention an error path to handle.
    expect(
      await asAdmin.query(api.channels.findDmWith, { workspaceId, otherUserId: adminId }),
    ).toBeNull();
  });

  it("does not leak a conversation to a non-member of the workspace", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, {
      name: "Member",
      email: "member@test.com",
    });
    const { asUser: asOutsider } = await setupAuthenticatedUser(t, {
      name: "Outsider",
      email: "out@test.com",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    await asAdmin.mutation(api.channels.createDm, { workspaceId, otherUserId: memberId });

    await expect(
      asOutsider.query(api.channels.findDmWith, { workspaceId, otherUserId: memberId }),
    ).rejects.toThrow("Not a member of this workspace");
  });

  it("matches through a membership row left pointing at a replaced account", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asAdmin } = await setupWorkspaceWithAdmin(t);
    const { userId: oldMemberId } = await setupAuthenticatedUser(t, {
      name: "Member",
      email: "member@test.com",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: oldMemberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    const channelId = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: oldMemberId,
    });

    // The same person, signed up again: a second `users` row carrying the
    // address the DM's membership row was denormalized with. An id-only scan
    // would report "no conversation" and the chip would offer to start the one
    // they are already in.
    const { userId: newMemberId } = await setupAuthenticatedUser(t, {
      name: "Member",
      email: "member@test.com",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", {
        userId: newMemberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    expect(
      await asAdmin.query(api.channels.findDmWith, { workspaceId, otherUserId: newMemberId }),
    ).toBe(channelId);

    // The query cannot write, so the stale row is still stale after it. The
    // repair belongs to `createDm`, which the chip calls next.
    const beforeOpen = await t.run(async (ctx) =>
      ctx.db
        .query("channelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    expect(beforeOpen.map((m) => m.userId)).toContain(oldMemberId);

    const reopened = await asAdmin.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: newMemberId,
    });
    expect(reopened, "the same conversation, not a second one").toBe(channelId);

    const afterOpen = await t.run(async (ctx) =>
      ctx.db
        .query("channelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    expect(afterOpen.map((m) => m.userId)).toContain(newMemberId);
    expect(afterOpen.map((m) => m.userId)).not.toContain(oldMemberId);
  });
});
