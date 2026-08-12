import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

type TestContext = ReturnType<typeof createTestContext>;

/**
 * A guest share link is stamped `endsAt + 24h` when it is issued. Rescheduling
 * an event used to leave that stamp on the OLD end, so every guest already
 * holding a link was locked out of the meeting they had just been told was
 * moved — while the corrected ICS and email RSVP kept working, which is what
 * made it hard to see. These pin the re-dating, including the two gates it must
 * NOT sit behind (`notifyInvitees`, and the historical-reschedule predicate).
 */

const sendEmail = vi.fn();

vi.mock("../convex/utils/sendPushToUsers", async () => {
  const probe = await import("./pushProbe");
  return probe.pushDeliveryMock();
});

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: (payload: unknown, options?: unknown) => sendEmail(payload, options),
    };
  },
}));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SHARE_BUFFER_MS = 24 * HOUR;
const BASE = new Date("2026-03-02T09:00:00.000Z").getTime();

let t: TestContext;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
  sendEmail.mockClear();
  t = createTestContext();
});
afterEach(() => vi.useRealTimers());

async function setupEventWithGuest(
  opts: { startsAt?: number; endsAt?: number } = {},
) {
  const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const startsAt = opts.startsAt ?? BASE + HOUR;
  const endsAt = opts.endsAt ?? startsAt + HOUR;

  const eventId = await asUser.mutation(api.calendarEvents.create, {
    workspaceId: workspaceId as never,
    title: "Vendor review",
    startsAt,
    endsAt,
    timezone: "UTC",
    invitees: { userIds: [], guestEmails: ["guest@external.com"] },
  });

  const detail = await asUser.query(api.calendarEvents.get, { eventId });
  const shareId = detail.invitees.find(
    (i) => i.guestEmail === "guest@external.com",
  )!.shareId!;

  return { workspaceId, asUser, eventId, shareId, startsAt, endsAt };
}

async function readShare(shareId: string) {
  return await t.run((ctx) =>
    ctx.db
      .query("resourceShares")
      .withIndex("by_shareId", (q) => q.eq("shareId", shareId))
      .first(),
  );
}

describe("calendarEvents.update — guest share re-dating", () => {
  it("moves the share expiry to the new end", async () => {
    const { asUser, eventId, shareId, endsAt } = await setupEventWithGuest();
    expect((await readShare(shareId))?.expiresAt).toBe(endsAt + SHARE_BUFFER_MS);

    const newStart = BASE + 7 * DAY;
    const newEnd = newStart + 2 * HOUR;
    await asUser.mutation(api.calendarEvents.update, {
      eventId,
      startsAt: newStart,
      endsAt: newEnd,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await readShare(shareId))?.expiresAt).toBe(
      newEnd + SHARE_BUFFER_MS,
    );
  });

  it("shortens the window when the event moves earlier", async () => {
    const { asUser, eventId, shareId } = await setupEventWithGuest({
      startsAt: BASE + 10 * DAY,
    });

    const newStart = BASE + 2 * HOUR;
    const newEnd = newStart + HOUR;
    await asUser.mutation(api.calendarEvents.update, {
      eventId,
      startsAt: newStart,
      endsAt: newEnd,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await readShare(shareId))?.expiresAt).toBe(
      newEnd + SHARE_BUFFER_MS,
    );
  });

  it("re-dates even when the organizer suppresses notifications", async () => {
    const { asUser, eventId, shareId } = await setupEventWithGuest();
    // Drop the original invitation mail, so what's counted below is only what
    // the reschedule sent.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    sendEmail.mockClear();

    const newEnd = BASE + 5 * DAY + HOUR;
    await asUser.mutation(api.calendarEvents.update, {
      eventId,
      startsAt: BASE + 5 * DAY,
      endsAt: newEnd,
      notifyInvitees: false,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Nothing was mailed — and the link still works. Suppressing the
    // announcement is exactly the case where a dead link is undiagnosable.
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await readShare(shareId))?.expiresAt).toBe(
      newEnd + SHARE_BUFFER_MS,
    );
  });

  it("re-dates a past→past edit, which notifies nobody", async () => {
    const { asUser, eventId, shareId } = await setupEventWithGuest({
      startsAt: BASE - 5 * DAY,
    });

    // Both old and new start are in the past, so `isHistoricalReschedule`
    // suppresses every notification channel. The share still has to track.
    const newEnd = BASE - 2 * DAY + HOUR;
    await asUser.mutation(api.calendarEvents.update, {
      eventId,
      startsAt: BASE - 2 * DAY,
      endsAt: newEnd,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await readShare(shareId))?.expiresAt).toBe(
      newEnd + SHARE_BUFFER_MS,
    );
  });

  it("guest can open the link and RSVP after the original expiry has passed", async () => {
    const { asUser, eventId, shareId, endsAt } = await setupEventWithGuest();
    const originalExpiry = endsAt + SHARE_BUFFER_MS;

    await asUser.mutation(api.calendarEvents.update, {
      eventId,
      startsAt: BASE + 30 * DAY,
      endsAt: BASE + 30 * DAY + HOUR,
      notifyInvitees: false,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Now stand past the window the guest's link originally carried. This is
    // the observable defect: `/share/<id>` reported expired and the guest
    // could not join the call they had just been re-invited to.
    vi.setSystemTime(originalExpiry + HOUR);

    const info = await t.query(api.calendarEvents.getByShareId, { shareId });
    expect(info.status).toBe("active");

    await t.mutation(api.calendarEvents.respondAsGuest, {
      shareId,
      status: "accepted",
      guestName: "Guest Person",
    });
    const after = await t.query(api.calendarEvents.getByShareId, { shareId });
    expect(after.invitee?.status).toBe("accepted");
  });

  it("leaves a revoked share revoked", async () => {
    const { asUser, eventId, shareId, endsAt } = await setupEventWithGuest();
    const originalExpiry = endsAt + SHARE_BUFFER_MS;
    await t.run(async (ctx) => {
      const share = (await ctx.db
        .query("resourceShares")
        .withIndex("by_shareId", (q) => q.eq("shareId", shareId))
        .first())!;
      await ctx.db.patch(share._id, { revokedAt: BASE });
    });

    await asUser.mutation(api.calendarEvents.update, {
      eventId,
      startsAt: BASE + 7 * DAY,
      endsAt: BASE + 7 * DAY + HOUR,
      notifyInvitees: false,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const share = await readShare(shareId);
    expect(share?.revokedAt).toBe(BASE);
    expect(share?.expiresAt).toBe(originalExpiry);
    expect(await t.query(api.calendarEvents.getByShareId, { shareId })).toMatchObject(
      { status: "revoked" },
    );
  });

  it("does not touch a hand-made share that no invitee row points at", async () => {
    const { asUser, eventId, workspaceId, shareId } =
      await setupEventWithGuest();

    // A link an operator made through the generic sharing UI: its expiry (here,
    // none at all) is a deliberate choice, not a mirror of the event's end.
    await t.run(async (ctx) => {
      const guestShare = (await ctx.db
        .query("resourceShares")
        .withIndex("by_shareId", (q) => q.eq("shareId", shareId))
        .first())!;
      await ctx.db.insert("resourceShares", {
        shareId: "hand-made-share-token",
        resourceType: "calendarEvent",
        resourceId: eventId,
        workspaceId: workspaceId as never,
        accessLevel: "view",
        createdBy: guestShare.createdBy,
        createdAt: BASE,
        name: "Acme review",
      });
    });

    await asUser.mutation(api.calendarEvents.update, {
      eventId,
      startsAt: BASE + 7 * DAY,
      endsAt: BASE + 7 * DAY + HOUR,
      notifyInvitees: false,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await readShare("hand-made-share-token"))?.expiresAt).toBeUndefined();
  });
});
