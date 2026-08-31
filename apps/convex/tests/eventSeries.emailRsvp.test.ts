/**
 * An RSVP that arrives by email, for a **series**.
 *
 * The reply a mail client sends about one occurrence names the series' UID and
 * carries a `RECURRENCE-ID` for the date the guest was looking at. That
 * coordinate is dropped at the worker boundary (packages/rsvp-worker) and the
 * answer applies to the series, so what reaches Convex is a series UID and
 * nothing else — which is exactly what these tests hand it.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { EMAIL_RSVP_DOMAIN } from "@ripple/shared/constants";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

type T = ReturnType<typeof createTestContext>;

const WEEKLY_STANDUP = {
  title: "Standup",
  anchorDate: "2026-09-01",
  anchorTime: "09:00",
  durationMs: 30 * 60 * 1000,
  timezone: "Europe/Rome",
  rule: {
    freq: "weekly" as const,
    interval: 1,
    weekdays: ["tuesday"],
    end: { kind: "never" as const },
  },
};

const GUEST = "guest@external.com";

async function seedSeriesWithGuest(t: T) {
  const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const seriesId = await asUser.mutation(api.eventSeries.create, {
    workspaceId,
    ...WEEKLY_STANDUP,
  });
  await asUser.mutation(api.eventSeries.addInvitees, {
    seriesId,
    userIds: [],
    guestEmails: [GUEST],
  });
  return { seriesId, asUser };
}

type Seeded = Awaited<ReturnType<typeof seedSeriesWithGuest>>;

async function guestStatus({ seriesId, asUser }: Seeded) {
  const rows = await asUser.query(api.eventSeries.listInvitees, { seriesId });
  return rows.find((r) => r.guestEmail === GUEST)?.status;
}

describe("a guest's emailed reply to a series", () => {
  let t: T;
  beforeEach(() => {
    t = createTestContext();
  });

  it("answers the whole series, not one occurrence of it", async () => {
    const seeded = await seedSeriesWithGuest(t);

    const result = await t.mutation(
      internal.calendarEventInvitees.recordEmailRsvp,
      {
        uid: `${seeded.seriesId}@${EMAIL_RSVP_DOMAIN}`,
        attendeeEmail: GUEST,
        partstat: "ACCEPTED",
        dtstamp: Date.UTC(2026, 7, 20, 12, 0, 0),
        sequence: 0,
      },
    );

    expect(result).toEqual({ applied: true });
    expect(await guestStatus(seeded)).toBe("accepted");
  });

  it("ignores a replay of the same answer, and takes a genuinely newer one", async () => {
    const seeded = await seedSeriesWithGuest(t);
    const reply = (over: { partstat?: "ACCEPTED" | "DECLINED"; dtstamp: number }) =>
      t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
        uid: `${seeded.seriesId}@${EMAIL_RSVP_DOMAIN}`,
        attendeeEmail: GUEST,
        partstat: over.partstat ?? "ACCEPTED",
        dtstamp: over.dtstamp,
        sequence: 0,
      });

    await reply({ dtstamp: 1_000 });
    // Outlook re-sends old replies on resync; the same DTSTAMP is not news.
    expect(await reply({ partstat: "DECLINED", dtstamp: 1_000 })).toEqual({
      applied: false,
      reason: "stale",
    });
    expect(await guestStatus(seeded)).toBe("accepted");

    expect(await reply({ partstat: "DECLINED", dtstamp: 2_000 })).toEqual({
      applied: true,
    });
    expect(await guestStatus(seeded)).toBe("declined");
  });

  it("drops an answer to a version of the pattern that has since changed", async () => {
    const seeded = await seedSeriesWithGuest(t);
    // The organizer moved a week, so everyone's copy was re-issued at a
    // higher SEQUENCE. A reply still quoting the old one is answering a
    // meeting that no longer exists in that shape.
    await seeded.asUser.mutation(api.eventSeries.cancelOccurrence, {
      seriesId: seeded.seriesId,
      originalStartMs: Date.parse("2026-09-08T07:00:00Z"),
    });

    expect(
      await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
        uid: `${seeded.seriesId}@${EMAIL_RSVP_DOMAIN}`,
        attendeeEmail: GUEST,
        partstat: "ACCEPTED",
        dtstamp: 1_000,
        sequence: 0,
      }),
    ).toEqual({ applied: false, reason: "stale" });
    expect(await guestStatus(seeded)).toBe("pending");
  });

  it("does not answer for someone who was never on the roster", async () => {
    const seeded = await seedSeriesWithGuest(t);
    expect(
      await t.mutation(internal.calendarEventInvitees.recordEmailRsvp, {
        uid: `${seeded.seriesId}@${EMAIL_RSVP_DOMAIN}`,
        attendeeEmail: "stranger@elsewhere.com",
        partstat: "ACCEPTED",
        dtstamp: 1_000,
        sequence: 0,
      }),
    ).toEqual({ applied: false, reason: "unknown_attendee" });
  });
});
