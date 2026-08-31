/**
 * Cancelling one occurrence, by either of the two routes that reach it.
 *
 * An edited occurrence becomes an **override** — an ordinary `calendarEvents`
 * row — and the product navigates to that row's own event page straight after
 * the edit. The "cancel" on that page therefore skips one occurrence of a
 * repeating meeting, and must tell the roster the same things the series'
 * own skip does.
 *
 * It did not: `calendarEvents.cancel` notifies from the *event's* invitee
 * rows, and an override has none — the roster belongs to the series. So the
 * occurrence vanished from the calendar while the guest's mail client kept
 * showing it, which is precisely the empty-room the recurring ICS exists to
 * prevent. These pin both routes to the same observable outcome.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

type T = ReturnType<typeof createTestContext>;

const sendEmail = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: (payload: unknown, options?: unknown) => sendEmail(payload, options),
    };
  },
}));

/** Tuesday 1 September 2026, 09:00–09:30 Rome, weekly, no end. */
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

/** The second Tuesday — the one every case here skips. */
const SECOND_TUESDAY = Date.parse("2026-09-08T07:00:00Z");

async function drainMail(t: T): Promise<string[]> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return sendEmail.mock.calls.map(([payload]) => (payload as { to: string }).to);
}

describe("cancelling one occurrence reaches the roster by either route", () => {
  let t: T;
  beforeEach(() => {
    vi.useFakeTimers();
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ data: { id: "resend-1" }, error: null });
    process.env.AUTH_RESEND_KEY = "re_test_key";
    process.env.RESEND_TEST_MODE = "false";
    t = createTestContext();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A weekly standup with one external guest, invitation already delivered. */
  async function seriesWithGuest() {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = (await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    })) as Id<"eventSeries">;
    await asUser.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [],
      guestEmails: ["guest@external.com"],
    });
    await drainMail(t);
    sendEmail.mockClear();
    return { workspaceId, seriesId, asUser };
  }

  async function occurrencesAround(
    asUser: Awaited<ReturnType<typeof seriesWithGuest>>["asUser"],
    workspaceId: Id<"workspaces">,
  ) {
    return await asUser.query(api.eventSeries.listMineInRange, {
      workspaceId,
      rangeStartMs: Date.parse("2026-09-07T00:00:00Z"),
      rangeEndMs: Date.parse("2026-09-10T00:00:00Z"),
    });
  }

  it("tells the guest when the skip comes from the series", async () => {
    const { workspaceId, seriesId, asUser } = await seriesWithGuest();

    await asUser.mutation(api.eventSeries.cancelOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
    });

    expect(await drainMail(t)).toEqual(["guest@external.com"]);
    expect(await occurrencesAround(asUser, workspaceId)).toHaveLength(0);
  });

  it("tells the guest when the skip comes from the override's own event page", async () => {
    const { workspaceId, seriesId, asUser } = await seriesWithGuest();

    // Editing one occurrence is what mints the override, and the product
    // lands the organizer on its event page — where the only removal control
    // is the ordinary "cancel".
    const overrideId = await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
      title: "Standup (this week's agenda)",
    });
    await drainMail(t);
    sendEmail.mockClear();

    await asUser.mutation(api.calendarEvents.cancel, { eventId: overrideId });

    expect(await drainMail(t)).toEqual(["guest@external.com"]);
    expect(await occurrencesAround(asUser, workspaceId)).toHaveLength(0);
  });

  it("leaves the rest of the series standing, whichever route was taken", async () => {
    const { workspaceId, seriesId, asUser } = await seriesWithGuest();

    const overrideId = await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
      title: "Standup (this week's agenda)",
    });
    await asUser.mutation(api.calendarEvents.cancel, { eventId: overrideId });

    expect(await asUser.query(api.eventSeries.get, { seriesId })).not.toBeNull();
    const september = await asUser.query(api.eventSeries.listMineInRange, {
      workspaceId,
      rangeStartMs: Date.parse("2026-09-01T00:00:00Z"),
      rangeEndMs: Date.parse("2026-10-01T00:00:00Z"),
    });
    // Five Tuesdays in September 2026, minus the skipped one.
    expect(september.map((o) => o.originalStartMs)).not.toContain(SECOND_TUESDAY);
    expect(september.length).toBeGreaterThan(0);
  });
});
