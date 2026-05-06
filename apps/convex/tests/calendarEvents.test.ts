import { describe, it, expect, beforeEach } from "vitest";
import { api } from "../convex/_generated/api";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

type TestContext = ReturnType<typeof createTestContext>;

const ONE_HOUR = 60 * 60 * 1000;

async function addMember(
  t: TestContext,
  workspaceId: string,
  userId: string,
  role: "admin" | "member",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMembers", {
      workspaceId: workspaceId as any,
      userId: userId as any,
      role,
    });
  });
}

describe("calendarEvents", () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });

  describe("create", () => {
    it("happy path: organiser + member + guest invitee with share row", async () => {
      const { workspaceId, asUser, userId: organiserId } =
        await setupWorkspaceWithAdmin(t);
      const { userId: memberId } = await setupAuthenticatedUser(t, {
        email: "alice@example.com",
        name: "Alice",
      });
      await addMember(t, workspaceId, memberId, WorkspaceRole.MEMBER);

      const start = Date.now() + 60 * 60 * 1000;
      const end = start + ONE_HOUR;
      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Sync",
        description: "Weekly catchup",
        startsAt: start,
        endsAt: end,
        timezone: "Europe/Rome",
        invitees: {
          userIds: [memberId as any],
          guestEmails: ["guest@external.com"],
        },
      });

      const detail = await asUser.query(api.calendarEvents.get, {
        eventId,
      });
      expect(detail.event.title).toBe("Sync");
      expect(detail.event.createdBy).toBe(organiserId);
      expect(detail.invitees).toHaveLength(2);

      const memberRow = detail.invitees.find((i) => i.userId === memberId);
      const guestRow = detail.invitees.find(
        (i) => i.guestEmail === "guest@external.com",
      );
      expect(memberRow?.status).toBe("pending");
      expect(memberRow?.shareId).toBeUndefined();
      expect(guestRow?.status).toBe("pending");
      expect(guestRow?.shareId).toBeTruthy();
      expect(guestRow?.guestSub).toBeTruthy();

      // The guest share is a real resourceShares row with the right shape.
      const shares = await t.run(async (ctx) => {
        return ctx.db
          .query("resourceShares")
          .withIndex("by_resource_id", (q) => q.eq("resourceId", eventId))
          .collect();
      });
      expect(shares).toHaveLength(1);
      expect(shares[0]?.resourceType).toBe("calendarEvent");
      expect(shares[0]?.accessLevel).toBe("join");
      expect(shares[0]?.shareId).toBe(guestRow?.shareId);
    });

    it("rejects when caller is not a workspace member", async () => {
      const { workspaceId } = await setupWorkspaceWithAdmin(t);
      const { asUser: asOutsider } = await setupAuthenticatedUser(t, {
        email: "outsider@test.com",
      });

      await expect(
        asOutsider.mutation(api.calendarEvents.create, {
          workspaceId: workspaceId as any,
          title: "Sneaky",
          startsAt: Date.now(),
          endsAt: Date.now() + ONE_HOUR,
          timezone: "UTC",
          invitees: { userIds: [], guestEmails: [] },
        }),
      ).rejects.toThrow(/Not a member/i);
    });

    it("rejects end ≤ start", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const start = Date.now();
      await expect(
        asUser.mutation(api.calendarEvents.create, {
          workspaceId: workspaceId as any,
          title: "Bad",
          startsAt: start,
          endsAt: start,
          timezone: "UTC",
          invitees: { userIds: [], guestEmails: [] },
        }),
      ).rejects.toThrow(/end must be after start/i);
    });

    it("rejects invalid email address", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      await expect(
        asUser.mutation(api.calendarEvents.create, {
          workspaceId: workspaceId as any,
          title: "Sync",
          startsAt: Date.now() + ONE_HOUR,
          endsAt: Date.now() + 2 * ONE_HOUR,
          timezone: "UTC",
          invitees: { userIds: [], guestEmails: ["not-an-email"] },
        }),
      ).rejects.toThrow(/Invalid email/i);
    });
  });

  describe("get / permissions", () => {
    it("invitee can read; non-invitee non-creator cannot", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const { userId: memberId, asUser: asMember } =
        await setupAuthenticatedUser(t, { email: "alice@test.com" });
      const { asUser: asOther } = await setupAuthenticatedUser(t, {
        email: "bob@test.com",
      });
      await addMember(t, workspaceId, memberId, WorkspaceRole.MEMBER);

      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Private",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [memberId as any], guestEmails: [] },
      });

      // Invitee reads OK.
      const ok = await asMember.query(api.calendarEvents.get, { eventId });
      expect(ok.event._id).toBe(eventId);

      // Non-invitee throws.
      await expect(
        asOther.query(api.calendarEvents.get, { eventId }),
      ).rejects.toThrow(/Not authorized/i);
    });
  });

  describe("respond", () => {
    it("invitee can change own RSVP status", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const { userId: memberId, asUser: asMember } =
        await setupAuthenticatedUser(t, { email: "alice@test.com" });
      await addMember(t, workspaceId, memberId, WorkspaceRole.MEMBER);

      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Sync",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [memberId as any], guestEmails: [] },
      });

      await asMember.mutation(api.calendarEvents.respond, {
        eventId,
        status: "accepted",
      });

      const detail = await asMember.query(api.calendarEvents.get, { eventId });
      const me = detail.invitees.find((i) => i.userId === memberId);
      expect(me?.status).toBe("accepted");
      expect(me?.respondedAt).toBeTypeOf("number");
    });

    it("non-invitee cannot respond", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const { userId: memberId } = await setupAuthenticatedUser(t, {
        email: "outsider@test.com",
      });
      await addMember(t, workspaceId, memberId, WorkspaceRole.MEMBER);
      const { asUser: asOther } = await setupAuthenticatedUser(t, {
        email: "other@test.com",
      });
      await addMember(t, workspaceId, memberId, WorkspaceRole.MEMBER);

      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Sync",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [], guestEmails: [] },
      });

      await expect(
        asOther.mutation(api.calendarEvents.respond, {
          eventId,
          status: "accepted",
        }),
      ).rejects.toThrow(/not invited/i);
    });
  });

  describe("cancel", () => {
    it("creator can cancel; revokes guest shares", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Sync",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [], guestEmails: ["guest@x.com"] },
      });

      await asUser.mutation(api.calendarEvents.cancel, { eventId });

      const detail = await asUser.query(api.calendarEvents.get, { eventId });
      expect(detail.event.cancelledAt).toBeTypeOf("number");

      const shares = await t.run(async (ctx) => {
        return ctx.db
          .query("resourceShares")
          .withIndex("by_resource_id", (q) => q.eq("resourceId", eventId))
          .collect();
      });
      expect(shares[0]?.revokedAt).toBeTypeOf("number");
    });

    it("non-creator cannot cancel", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const { userId: memberId, asUser: asMember } =
        await setupAuthenticatedUser(t, { email: "alice@test.com" });
      await addMember(t, workspaceId, memberId, WorkspaceRole.MEMBER);

      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Sync",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [memberId as any], guestEmails: [] },
      });

      await expect(
        asMember.mutation(api.calendarEvents.cancel, { eventId }),
      ).rejects.toThrow(/Only the organizer/i);
    });
  });

  describe("getByShareId / respondAsGuest", () => {
    it("public lookup returns event for a valid share, and guest can RSVP", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Demo",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [], guestEmails: ["guest@external.com"] },
      });
      const detail = await asUser.query(api.calendarEvents.get, { eventId });
      const guestRow = detail.invitees.find(
        (i) => i.guestEmail === "guest@external.com",
      );
      const shareId = guestRow!.shareId!;

      // No identity — getByShareId is public.
      const info = await t.query(api.calendarEvents.getByShareId, { shareId });
      expect(info.status).toBe("active");
      expect(info.event?.title).toBe("Demo");
      expect(info.invitee?.status).toBe("pending");

      await t.mutation(api.calendarEvents.respondAsGuest, {
        shareId,
        status: "accepted",
        guestName: "Guest Person",
      });

      const after = await t.query(api.calendarEvents.getByShareId, { shareId });
      expect(after.invitee?.status).toBe("accepted");
      expect(after.invitee?.guestName).toBe("Guest Person");
    });

    it("rejects unknown / non-event shareId", async () => {
      await expect(
        t.mutation(api.calendarEvents.respondAsGuest, {
          shareId: "definitely-not-a-real-share",
          status: "accepted",
          guestName: "X",
        }),
      ).rejects.toThrow(/not found|Invalid/i);
    });

    it("after cancellation, guest landing reports revoked", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Demo",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [], guestEmails: ["guest@external.com"] },
      });
      const detail = await asUser.query(api.calendarEvents.get, { eventId });
      const shareId = detail.invitees.find((i) => i.guestEmail)!.shareId!;
      await asUser.mutation(api.calendarEvents.cancel, { eventId });

      const info = await t.query(api.calendarEvents.getByShareId, { shareId });
      expect(info.status).toBe("revoked");
    });
  });
});
