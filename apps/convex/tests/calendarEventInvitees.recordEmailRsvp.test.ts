import { describe, it, expect, beforeEach } from "vitest";
import { api } from "../convex/_generated/api";
import { internal } from "../convex/_generated/api";
import { EMAIL_RSVP_DOMAIN } from "@ripple/shared/constants";
import { setupAuthenticatedUser, setupWorkspaceWithAdmin, createTestContext } from "./helpers";

type TestContext = ReturnType<typeof createTestContext>;

const ONE_HOUR = 60 * 60 * 1000;

function uidFor(eventId: string): string {
  return `${eventId}@${EMAIL_RSVP_DOMAIN}`;
}

async function inviteMember(
  t: TestContext,
  workspaceId: string,
  email: string,
) {
  const { userId } = await setupAuthenticatedUser(t, {
    name: email.split("@")[0],
    email,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMembers", {
      workspaceId: workspaceId as any,
      userId: userId as any,
      role: "member",
    });
  });
  return userId;
}

async function getInvitee(t: TestContext, eventId: string, predicate: (row: any) => boolean) {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query("calendarEventInvitees")
      .withIndex("by_event", (q) => q.eq("eventId", eventId as any))
      .collect();
    return rows.find(predicate) ?? null;
  });
}

describe("calendarEventInvitees.recordEmailRsvp", () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });

  it("ACCEPTED from a member: status=accepted, fields populated", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const memberEmail = "alice@test.com";
    const memberId = await inviteMember(t, workspaceId, memberEmail);

    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [memberId as any], guestEmails: [] },
    });

    const result = await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
      uid: uidFor(eventId),
      attendeeEmail: memberEmail,
      partstat: "ACCEPTED",
      dtstamp: Date.now(),
      sequence: 0,
    });

    expect(result).toEqual({ applied: true });
    const row = await getInvitee(t, eventId, (r) => r.userId === memberId);
    expect(row?.status).toBe("accepted");
    expect(row?.respondedAt).toBeTypeOf("number");
    expect(row?.lastRsvpDtstamp).toBeTypeOf("number");
    expect(row?.lastRsvpSequence).toBe(0);
  });

  it("TENTATIVE from a guest: matches via by_event_guest_email", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const guestEmail = "guest@external.com";
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Demo",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [guestEmail] },
    });

    const result = await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
      uid: uidFor(eventId),
      attendeeEmail: guestEmail,
      partstat: "TENTATIVE",
      dtstamp: Date.now(),
      sequence: 0,
    });

    expect(result).toEqual({ applied: true });
    const row = await getInvitee(t, eventId, (r) => r.guestEmail === guestEmail);
    expect(row?.status).toBe("tentative");
    expect(row?.lastRsvpSequence).toBe(0);
  });

  it("unknown event UID -> reason=unknown_event", async () => {
    await setupWorkspaceWithAdmin(t);
    const result = await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
      uid: `not-a-real-id@${EMAIL_RSVP_DOMAIN}`,
      attendeeEmail: "x@y.com",
      partstat: "ACCEPTED",
      dtstamp: Date.now(),
      sequence: 0,
    });
    expect(result).toEqual({ applied: false, reason: "unknown_event" });
  });

  it("foreign UID domain -> reason=unknown_event", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const memberId = await inviteMember(t, workspaceId, "alice@test.com");
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [memberId as any], guestEmails: [] },
    });

    const result = await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
      uid: `${eventId}@elsewhere.example`,
      attendeeEmail: "alice@test.com",
      partstat: "ACCEPTED",
      dtstamp: Date.now(),
      sequence: 0,
    });
    expect(result).toEqual({ applied: false, reason: "unknown_event" });
  });

  it("attendee not on the invite list -> unknown_attendee", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const memberId = await inviteMember(t, workspaceId, "alice@test.com");
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [memberId as any], guestEmails: [] },
    });

    const result = await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
      uid: uidFor(eventId),
      attendeeEmail: "stranger@test.com",
      partstat: "DECLINED",
      dtstamp: Date.now(),
      sequence: 0,
    });
    expect(result).toEqual({ applied: false, reason: "unknown_attendee" });
  });

  it("REPLY with sequence < event.sequence -> stale", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const memberId = await inviteMember(t, workspaceId, "alice@test.com");
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [memberId as any], guestEmails: [] },
    });
    // Bump event.sequence directly to simulate post-reschedule state.
    await t.run(async (ctx) => {
      await ctx.db.patch(eventId as any, { sequence: 3 });
    });

    const result = await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
      uid: uidFor(eventId),
      attendeeEmail: "alice@test.com",
      partstat: "ACCEPTED",
      dtstamp: Date.now(),
      sequence: 1,
    });
    expect(result).toEqual({ applied: false, reason: "stale" });
  });

  it("repeat REPLY at same sequence with non-newer dtstamp -> stale", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const memberId = await inviteMember(t, workspaceId, "alice@test.com");
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [memberId as any], guestEmails: [] },
    });

    const dt1 = Date.now();
    const r1 = await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
      uid: uidFor(eventId),
      attendeeEmail: "alice@test.com",
      partstat: "ACCEPTED",
      dtstamp: dt1,
      sequence: 0,
    });
    expect(r1).toEqual({ applied: true });

    // Same dtstamp, same sequence — exact re-delivery.
    const r2 = await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
      uid: uidFor(eventId),
      attendeeEmail: "alice@test.com",
      partstat: "DECLINED",
      dtstamp: dt1,
      sequence: 0,
    });
    expect(r2).toEqual({ applied: false, reason: "stale" });

    // Status must NOT have flipped.
    const row = await getInvitee(t, eventId, (r) => r.userId === memberId);
    expect(row?.status).toBe("accepted");
  });

  it("cancelled (hard-deleted) event -> unknown_event", async () => {
    // Soft-delete was removed: cancellation hard-deletes the row + cascade.
    // A REPLY arriving after cancellation can no longer find the event,
    // so the worker reports unknown_event (no row to update, no organizer
    // to notify) and the inbound email is silently dropped.
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const memberId = await inviteMember(t, workspaceId, "alice@test.com");
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [memberId as any], guestEmails: [] },
    });
    await asUser.mutation(api.calendarEvents.cancel, { eventId });

    const result = await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
      uid: uidFor(eventId),
      attendeeEmail: "alice@test.com",
      partstat: "ACCEPTED",
      dtstamp: Date.now(),
      sequence: 0,
    });
    expect(result).toEqual({ applied: false, reason: "unknown_event" });
  });

  it("strictly newer dtstamp at same sequence -> applied (status flips)", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const memberId = await inviteMember(t, workspaceId, "alice@test.com");
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [memberId as any], guestEmails: [] },
    });

    await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
      uid: uidFor(eventId),
      attendeeEmail: "alice@test.com",
      partstat: "ACCEPTED",
      dtstamp: 1_000,
      sequence: 0,
    });
    const r2 = await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
      uid: uidFor(eventId),
      attendeeEmail: "alice@test.com",
      partstat: "DECLINED",
      dtstamp: 2_000,
      sequence: 0,
    });
    expect(r2).toEqual({ applied: true });

    const row = await getInvitee(t, eventId, (r) => r.userId === memberId);
    expect(row?.status).toBe("declined");
    expect(row?.lastRsvpDtstamp).toBe(2_000);
  });

  it("calendarEvents.get succeeds after an email RSVP populates idempotency fields", async () => {
    // Regression: recordEmailRsvp writes lastRsvpDtstamp/lastRsvpSequence onto
    // the invitee row. calendarEvents.get returns the full row, so its return
    // validator must include those fields — otherwise the event becomes
    // unopenable (ReturnsValidationError) the moment anyone RSVPs by email.
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const memberEmail = "alice@test.com";
    const memberId = await inviteMember(t, workspaceId, memberEmail);
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [memberId as any], guestEmails: [] },
    });

    await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
      uid: uidFor(eventId),
      attendeeEmail: memberEmail,
      partstat: "ACCEPTED",
      dtstamp: Date.now(),
      sequence: 0,
    });

    const detail = await asUser.query(api.calendarEvents.get, { eventId });
    const memberRow = detail.invitees.find((i) => i.userId === memberId);
    expect(memberRow?.status).toBe("accepted");
    expect(memberRow?.lastRsvpSequence).toBe(0);
  });

  it("attendee email is matched case-insensitively", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const memberId = await inviteMember(t, workspaceId, "alice@test.com");
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [memberId as any], guestEmails: [] },
    });

    const r = await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
      uid: uidFor(eventId),
      attendeeEmail: "ALICE@TEST.COM",
      partstat: "ACCEPTED",
      dtstamp: Date.now(),
      sequence: 0,
    });
    expect(r).toEqual({ applied: true });
  });
});
