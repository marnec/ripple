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

  describe("update (notifyInvitees flag)", () => {
    // The update mutation hands off both kinds of notification (in-app
    // push + guest email) to the Convex scheduler — we assert by
    // counting `_scheduled_functions` rows whose `name` matches the
    // expected handler before vs. after the mutation. The diff
    // approach is robust to other scheduled work the create/update
    // paths happen to enqueue (push delivery worker, audit log, etc.).
    async function countScheduled(predicate: (name: string) => boolean) {
      const rows = await t.run(async (ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      return rows.filter((r: any) => predicate(String(r.name ?? "")))
        .length;
    }

    it("default (flag omitted): an in-app deliverPush is scheduled", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const { userId: memberId } = await setupAuthenticatedUser(t, {
        email: "alice@test.com",
      });
      await addMember(t, workspaceId, memberId, WorkspaceRole.MEMBER);

      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Sync",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [memberId as any], guestEmails: [] },
      });

      const before = await countScheduled((n) => n.includes("deliverPush"));
      await asUser.mutation(api.calendarEvents.update, {
        eventId,
        startsAt: Date.now() + 2 * ONE_HOUR,
        endsAt: Date.now() + 3 * ONE_HOUR,
      });
      const after = await countScheduled((n) => n.includes("deliverPush"));
      expect(after).toBeGreaterThan(before);
    });

    it("notifyInvitees: false suppresses BOTH in-app + email notifications", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const { userId: memberId } = await setupAuthenticatedUser(t, {
        email: "bob@test.com",
      });
      await addMember(t, workspaceId, memberId, WorkspaceRole.MEMBER);

      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Sync silent",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [memberId as any], guestEmails: ["g@x.com"] },
      });

      const beforeDeliver = await countScheduled((n) => n.includes("deliverPush"));
      const beforeEmail = await countScheduled((n) => n.includes("sendEventReschedule"));
      await asUser.mutation(api.calendarEvents.update, {
        eventId,
        startsAt: Date.now() + 3 * ONE_HOUR,
        endsAt: Date.now() + 4 * ONE_HOUR,
        notifyInvitees: false,
      });
      const afterDeliver = await countScheduled((n) => n.includes("deliverPush"));
      const afterEmail = await countScheduled((n) => n.includes("sendEventReschedule"));

      expect(afterDeliver).toBe(beforeDeliver);
      expect(afterEmail).toBe(beforeEmail);
    });

    it("notifyInvitees: true + time change schedules the reschedule email for guests", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "External",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [], guestEmails: ["g@external.com"] },
      });

      const before = await countScheduled((n) => n.includes("sendEventReschedule"));
      await asUser.mutation(api.calendarEvents.update, {
        eventId,
        startsAt: Date.now() + 5 * ONE_HOUR,
        endsAt: Date.now() + 6 * ONE_HOUR,
        notifyInvitees: true,
      });
      const after = await countScheduled((n) => n.includes("sendEventReschedule"));
      expect(after).toBeGreaterThan(before);
    });

    it("notifyInvitees: true on a non-time edit does NOT schedule a reschedule email", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Title only",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [], guestEmails: ["g@external.com"] },
      });

      const before = await countScheduled((n) => n.includes("sendEventReschedule"));
      await asUser.mutation(api.calendarEvents.update, {
        eventId,
        title: "Renamed",
        notifyInvitees: true,
      });
      const after = await countScheduled((n) => n.includes("sendEventReschedule"));
      // Reschedule emails are time-change-specific — title rename
      // does NOT trigger one.
      expect(after).toBe(before);
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

  describe("remove (delete)", () => {
    it("organiser can hard-delete a solo event", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Solo focus",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [], guestEmails: [] },
      });

      await asUser.mutation(api.calendarEvents.remove, { eventId });

      // `get` throws "Event not found" once the row is gone.
      await expect(
        asUser.query(api.calendarEvents.get, { eventId }),
      ).rejects.toThrow(/not found/i);
    });

    it("refuses to delete a non-cancelled guest event", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "With guests",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [], guestEmails: ["guest@x.com"] },
      });

      await expect(
        asUser.mutation(api.calendarEvents.remove, { eventId }),
      ).rejects.toThrow(/Cancel this event before deleting/i);
    });

    it("allows delete after cancel for guest events; cleans up shares", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Cancelled then deleted",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [], guestEmails: ["guest@x.com"] },
      });

      await asUser.mutation(api.calendarEvents.cancel, { eventId });
      await asUser.mutation(api.calendarEvents.remove, { eventId });

      // Event row deleted.
      const ev = await t.run(async (ctx) => ctx.db.get(eventId));
      expect(ev).toBeNull();

      // Invitee + share rows cleaned up.
      const invitees = await t.run(async (ctx) =>
        ctx.db
          .query("calendarEventInvitees")
          .withIndex("by_event", (q) => q.eq("eventId", eventId))
          .collect(),
      );
      expect(invitees.length).toBe(0);
      const shares = await t.run(async (ctx) =>
        ctx.db
          .query("resourceShares")
          .withIndex("by_resource_id", (q) => q.eq("resourceId", eventId))
          .collect(),
      );
      expect(shares.length).toBe(0);
    });

    it("non-organiser cannot delete", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const { userId: memberId, asUser: asMember } =
        await setupAuthenticatedUser(t, { email: "bob@test.com" });
      await addMember(t, workspaceId, memberId, WorkspaceRole.MEMBER);

      const eventId = await asUser.mutation(api.calendarEvents.create, {
        workspaceId: workspaceId as any,
        title: "Solo focus",
        startsAt: Date.now() + ONE_HOUR,
        endsAt: Date.now() + 2 * ONE_HOUR,
        timezone: "UTC",
        invitees: { userIds: [], guestEmails: [] },
      });

      await expect(
        asMember.mutation(api.calendarEvents.remove, { eventId }),
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

  describe("listForMembersInRange (member calendar overlay)", () => {
    // Helper: insert a calendarEvents row directly via t.run so each test
    // can stage events authored by users it cares about without going
    // through the public mutation (which always sets createdBy = caller).
    async function insertEvent(
      ctx: TestContext,
      args: {
        workspaceId: string;
        createdBy: string;
        title: string;
        startsAt: number;
        endsAt: number;
        cancelledAt?: number;
      },
    ) {
      return await ctx.run(async (db) => {
        return await db.db.insert("calendarEvents", {
          workspaceId: args.workspaceId as any,
          title: args.title,
          startsAt: args.startsAt,
          endsAt: args.endsAt,
          timezone: "UTC",
          createdBy: args.createdBy as any,
          cancelledAt: args.cancelledAt,
        });
      });
    }
    async function insertInvitee(
      ctx: TestContext,
      args: {
        eventId: string;
        workspaceId: string;
        userId: string;
      },
    ) {
      await ctx.run(async (db) => {
        await db.db.insert("calendarEventInvitees", {
          eventId: args.eventId as any,
          workspaceId: args.workspaceId as any,
          userId: args.userId as any,
          status: "pending",
        });
      });
    }

    it("rejects when caller is not a workspace member", async () => {
      const { workspaceId, userId: memberId } = await setupWorkspaceWithAdmin(t);
      const { asUser: asOutsider } = await setupAuthenticatedUser(t, {
        email: "outsider@test.com",
      });
      await expect(
        asOutsider.query(api.calendarEvents.listForMembersInRange, {
          workspaceId: workspaceId as any,
          memberIds: [memberId as any],
          rangeStartMs: Date.now(),
          rangeEndMs: Date.now() + 24 * ONE_HOUR,
        }),
      ).rejects.toThrow(/Not a member/i);
    });

    it("returns busy-blocks for events organised AND attended by the member", async () => {
      const { workspaceId, asUser: asViewer } = await setupWorkspaceWithAdmin(t);
      const { userId: aliceId } = await setupAuthenticatedUser(t, {
        email: "alice@test.com",
        name: "Alice",
      });
      const { userId: bobId } = await setupAuthenticatedUser(t, {
        email: "bob@test.com",
        name: "Bob",
      });
      await addMember(t, workspaceId, aliceId, WorkspaceRole.MEMBER);
      await addMember(t, workspaceId, bobId, WorkspaceRole.MEMBER);

      const now = Date.now();
      // Alice organises one event…
      const aliceEvent = await insertEvent(t, {
        workspaceId,
        createdBy: aliceId,
        title: "Alice solo",
        startsAt: now + ONE_HOUR,
        endsAt: now + 2 * ONE_HOUR,
      });
      // …and is invited to a second one that Bob organises.
      const bobEvent = await insertEvent(t, {
        workspaceId,
        createdBy: bobId,
        title: "Bob hosts",
        startsAt: now + 3 * ONE_HOUR,
        endsAt: now + 4 * ONE_HOUR,
      });
      await insertInvitee(t, {
        eventId: bobEvent,
        workspaceId,
        userId: aliceId,
      });

      const blocks = await asViewer.query(
        api.calendarEvents.listForMembersInRange,
        {
          workspaceId: workspaceId as any,
          memberIds: [aliceId as any],
          rangeStartMs: now,
          rangeEndMs: now + 24 * ONE_HOUR,
        },
      );
      expect(blocks).toHaveLength(2);
      const ids = blocks.map((b) => b.startsAt).sort();
      expect(ids).toEqual([now + ONE_HOUR, now + 3 * ONE_HOUR]);
      // Privacy: only timing + memberId leak, never titles.
      for (const b of blocks) {
        expect(Object.keys(b).sort()).toEqual([
          "endsAt",
          "memberId",
          "startsAt",
        ]);
        expect(b.memberId).toBe(aliceId);
      }
      // Sanity: aliceEvent is one of them.
      expect(blocks.some((b) => b.startsAt === now + ONE_HOUR)).toBe(true);
      void aliceEvent;
    });

    it("filters out cancelled events", async () => {
      const { workspaceId, asUser: asViewer } = await setupWorkspaceWithAdmin(t);
      const { userId: aliceId } = await setupAuthenticatedUser(t, {
        email: "alice@test.com",
      });
      await addMember(t, workspaceId, aliceId, WorkspaceRole.MEMBER);

      const now = Date.now();
      await insertEvent(t, {
        workspaceId,
        createdBy: aliceId,
        title: "Cancelled",
        startsAt: now + ONE_HOUR,
        endsAt: now + 2 * ONE_HOUR,
        cancelledAt: now,
      });

      const blocks = await asViewer.query(
        api.calendarEvents.listForMembersInRange,
        {
          workspaceId: workspaceId as any,
          memberIds: [aliceId as any],
          rangeStartMs: now,
          rangeEndMs: now + 24 * ONE_HOUR,
        },
      );
      expect(blocks).toHaveLength(0);
    });

    it("filters out events outside the requested range", async () => {
      const { workspaceId, asUser: asViewer } = await setupWorkspaceWithAdmin(t);
      const { userId: aliceId } = await setupAuthenticatedUser(t, {
        email: "alice@test.com",
      });
      await addMember(t, workspaceId, aliceId, WorkspaceRole.MEMBER);

      const now = Date.now();
      // Way before
      await insertEvent(t, {
        workspaceId,
        createdBy: aliceId,
        title: "Past",
        startsAt: now - 10 * 24 * ONE_HOUR,
        endsAt: now - 10 * 24 * ONE_HOUR + ONE_HOUR,
      });
      // Way after
      await insertEvent(t, {
        workspaceId,
        createdBy: aliceId,
        title: "Future",
        startsAt: now + 10 * 24 * ONE_HOUR,
        endsAt: now + 10 * 24 * ONE_HOUR + ONE_HOUR,
      });
      // In window
      await insertEvent(t, {
        workspaceId,
        createdBy: aliceId,
        title: "Now-ish",
        startsAt: now + ONE_HOUR,
        endsAt: now + 2 * ONE_HOUR,
      });

      const blocks = await asViewer.query(
        api.calendarEvents.listForMembersInRange,
        {
          workspaceId: workspaceId as any,
          memberIds: [aliceId as any],
          rangeStartMs: now,
          rangeEndMs: now + 24 * ONE_HOUR,
        },
      );
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.startsAt).toBe(now + ONE_HOUR);
    });

    it("excludes events the viewer already sees in their own calendar", async () => {
      // Viewer organises an event with Alice as invitee. Viewer requests
      // the overlay for Alice. The shared event must NOT come back as a
      // busy-block — listMineInRange already shows it as a regular event,
      // and a duplicate ghost would clutter the calendar.
      const { workspaceId, asUser: asViewer, userId: viewerId } =
        await setupWorkspaceWithAdmin(t);
      const { userId: aliceId } = await setupAuthenticatedUser(t, {
        email: "alice@test.com",
      });
      await addMember(t, workspaceId, aliceId, WorkspaceRole.MEMBER);

      const now = Date.now();
      const sharedEvent = await insertEvent(t, {
        workspaceId,
        createdBy: viewerId,
        title: "Shared",
        startsAt: now + ONE_HOUR,
        endsAt: now + 2 * ONE_HOUR,
      });
      await insertInvitee(t, {
        eventId: sharedEvent,
        workspaceId,
        userId: aliceId,
      });
      // Alice also has a private event the viewer is NOT on.
      await insertEvent(t, {
        workspaceId,
        createdBy: aliceId,
        title: "Alice private",
        startsAt: now + 3 * ONE_HOUR,
        endsAt: now + 4 * ONE_HOUR,
      });

      const blocks = await asViewer.query(
        api.calendarEvents.listForMembersInRange,
        {
          workspaceId: workspaceId as any,
          memberIds: [aliceId as any],
          rangeStartMs: now,
          rangeEndMs: now + 24 * ONE_HOUR,
        },
      );
      // Only Alice's private event leaks through as a busy-block.
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.startsAt).toBe(now + 3 * ONE_HOUR);
    });

    it("ignores cross-workspace probing — memberIds outside the workspace yield nothing", async () => {
      const { workspaceId, asUser: asViewer } = await setupWorkspaceWithAdmin(t);
      // Alice exists but is NOT a member of `workspaceId`.
      const { userId: outsiderId } = await setupAuthenticatedUser(t, {
        email: "outsider@elsewhere.com",
      });

      const now = Date.now();
      // Plant an event the outsider organises in a *different* workspace
      // — even if our query happened to scan globally by-creator, the
      // workspace check should keep it out.
      const otherWs = await t.run(async (ctx) => {
        const ws = await ctx.db.insert("workspaces", {
          name: "Other",
          ownerId: outsiderId,
        });
        await ctx.db.insert("workspaceMembers", {
          workspaceId: ws,
          userId: outsiderId,
          role: WorkspaceRole.ADMIN,
        });
        return ws;
      });
      await insertEvent(t, {
        workspaceId: otherWs,
        createdBy: outsiderId,
        title: "Hidden",
        startsAt: now + ONE_HOUR,
        endsAt: now + 2 * ONE_HOUR,
      });

      const blocks = await asViewer.query(
        api.calendarEvents.listForMembersInRange,
        {
          workspaceId: workspaceId as any,
          memberIds: [outsiderId as any],
          rangeStartMs: now,
          rangeEndMs: now + 24 * ONE_HOUR,
        },
      );
      expect(blocks).toHaveLength(0);
    });

    it("returns [] for empty memberIds (no work, no auth surprise)", async () => {
      const { workspaceId, asUser: asViewer } = await setupWorkspaceWithAdmin(t);
      const blocks = await asViewer.query(
        api.calendarEvents.listForMembersInRange,
        {
          workspaceId: workspaceId as any,
          memberIds: [],
          rangeStartMs: Date.now(),
          rangeEndMs: Date.now() + 24 * ONE_HOUR,
        },
      );
      expect(blocks).toEqual([]);
    });
  });
});
