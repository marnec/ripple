/**
 * What a guest of a repeating meeting actually receives.
 *
 * The observable here is the message that reaches Resend, and how many of them
 * there are — a recurring standup must fill an inbox with one invitation, not
 * one per Tuesday. The ICS body itself is not asserted: its assembly is
 * module-private (spec 0003, "Testing Decisions") and the only part worth
 * pinning is the rule text, which `@ripple/shared/recurrence` owns and tests.
 * What is asserted is the calendar *method* each message carries, because
 * REQUEST-versus-CANCEL is the difference between a guest's client updating an
 * entry and deleting it.
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

/** Tuesday 1 September 2026, 09:00–09:30 Rome. */
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

/** One message as it reached Resend: who it went to and what method it carries. */
interface SentMail {
  to: string;
  method: "REQUEST" | "CANCEL";
}

/** Drain the email pool and report every message that actually went out. */
async function drainMail(t: T): Promise<SentMail[]> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return sendEmail.mock.calls.map(([payload]) => {
    const p = payload as {
      to: string;
      attachments: Array<{ contentType: string }>;
    };
    const contentType = p.attachments[0]!.contentType;
    return {
      to: p.to,
      method: /method=CANCEL/i.test(contentType) ? "CANCEL" : "REQUEST",
    };
  });
}

describe("a guest invited to a series", () => {
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

  it("receives exactly one invitation for the whole repeating pattern", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    // A skipped week, so the invitation has exclusions to carry.
    await asUser.mutation(api.eventSeries.cancelOccurrence, {
      seriesId,
      originalStartMs: Date.parse("2026-09-08T07:00:00Z"),
    });
    sendEmail.mockClear();

    await asUser.mutation(api.eventSeries.addInvitees, {
      seriesId: seriesId as Id<"eventSeries">,
      userIds: [],
      guestEmails: ["guest@external.com"],
    });

    expect(await drainMail(t)).toEqual([
      { to: "guest@external.com", method: "REQUEST" },
    ]);
  });
});

describe("splitting a series with \"this and following\"", () => {
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

  it("updates the truncated original and freshly invites to the continuation, cancelling nothing", async () => {
    // A CANCEL here would make the guest's client delete the meetings that
    // already happened — history the organizer never asked to lose. The
    // truncated original keeps its UID and simply ends earlier; the
    // continuation arrives as a second, separate invitation.
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await asUser.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [],
      guestEmails: ["guest@external.com"],
    });
    await drainMail(t);
    sendEmail.mockClear();

    await asUser.mutation(api.eventSeries.updateFollowing, {
      seriesId,
      originalStartMs: Date.parse("2026-09-15T07:00:00Z"),
      anchorTime: "09:30",
    });

    const sent = await drainMail(t);
    expect(sent).toHaveLength(2);
    expect(sent.every((m) => m.to === "guest@external.com")).toBe(true);
    expect(sent.map((m) => m.method)).toEqual(["REQUEST", "REQUEST"]);
  });
});

describe("the sequence counter a guest's client dedupes on", () => {
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

  it("advances once per guest-facing change, and never for a new invitation", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    const sequence = async () =>
      (await asUser.query(api.eventSeries.get, { seriesId }))?.sequence;

    await asUser.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [],
      guestEmails: ["guest@external.com"],
    });
    // Adding someone changes nothing about the meeting itself; bumping here
    // would make every already-delivered copy look out of date.
    expect(await sequence()).toBeUndefined();

    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: Date.parse("2026-09-15T07:00:00Z"),
      startsAt: Date.parse("2026-09-16T07:00:00Z"),
      endsAt: Date.parse("2026-09-16T07:30:00Z"),
    });
    expect(await sequence()).toBe(1);

    await asUser.mutation(api.eventSeries.cancelOccurrence, {
      seriesId,
      originalStartMs: Date.parse("2026-09-22T07:00:00Z"),
    });
    expect(await sequence()).toBe(2);

    await asUser.mutation(api.eventSeries.updateSeries, {
      seriesId,
      title: "Morning standup",
    });
    expect(await sequence()).toBe(3);
  });

  it("leaves an override row's own sequence unwritten", async () => {
    // There is one counter per UID, and the UID is the series'. A second
    // counter on the override row is how a client ends up ignoring an update.
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await asUser.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [],
      guestEmails: ["guest@external.com"],
    });

    const overrideId = await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: Date.parse("2026-09-15T07:00:00Z"),
      startsAt: Date.parse("2026-09-16T07:00:00Z"),
      endsAt: Date.parse("2026-09-16T07:30:00Z"),
    });

    const override = await t.run((ctx) => ctx.db.get(overrideId));
    expect(override?.sequence).toBeUndefined();
  });

  it("takes a skipped week off the guest's calendar with one update", async () => {
    // The skip travels as an EXDATE on the pattern the guest already holds —
    // never as a cancellation, which would take the whole series with it.
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await asUser.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [],
      guestEmails: ["guest@external.com"],
    });
    await drainMail(t);
    sendEmail.mockClear();

    await asUser.mutation(api.eventSeries.cancelOccurrence, {
      seriesId,
      originalStartMs: Date.parse("2026-09-08T07:00:00Z"),
    });

    expect(await drainMail(t)).toEqual([
      { to: "guest@external.com", method: "REQUEST" },
    ]);
  });

  it("withdraws the series from the guest's calendar when it is cancelled", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await asUser.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [],
      guestEmails: ["guest@external.com"],
    });
    await drainMail(t);
    sendEmail.mockClear();

    await asUser.mutation(api.eventSeries.cancel, { seriesId });

    expect(await drainMail(t)).toEqual([
      { to: "guest@external.com", method: "CANCEL" },
    ]);
  });

  it("tells the roster about a moved occurrence in one update, not one per date", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await asUser.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [],
      guestEmails: ["guest@external.com"],
    });
    await drainMail(t);
    sendEmail.mockClear();

    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: Date.parse("2026-09-15T07:00:00Z"),
      startsAt: Date.parse("2026-09-16T07:00:00Z"),
      endsAt: Date.parse("2026-09-16T07:30:00Z"),
    });

    expect(await drainMail(t)).toEqual([
      { to: "guest@external.com", method: "REQUEST" },
    ]);
  });
});

/**
 * The two lanes a change reaches a roster by — the in-app fan-out and this
 * guest mail — turn on one answer, not two. Ticket 11 owns whether a change is
 * announced at all; ticket 09 owns what a guest's client receives when it is.
 * These pin the seam between them: an organizer who declines the prompt, or
 * who is tidying up meetings that already happened, sends nothing by *either*
 * route. Gating only the in-app lane would leave the guest mailed anyway,
 * which is the failure this file exists to catch.
 */
describe("a change that is not being announced", () => {
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

  /** A series with one external guest on its roster, invitation already sent. */
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
    return { seriesId, asUser };
  }

  it("mails no guest when the organizer declines the prompt", async () => {
    const { seriesId, asUser } = await seriesWithGuest();

    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: Date.parse("2026-09-08T07:00:00Z"),
      title: "Standup (moved)",
      notifyInvitees: false,
    });

    expect(await drainMail(t)).toEqual([]);
  });

  it("mails no guest when every occurrence it touches is already past", async () => {
    const { seriesId, asUser } = await seriesWithGuest();

    // Housekeeping: the organizer skips a week that has already happened.
    vi.setSystemTime(Date.parse("2026-10-01T00:00:00Z"));
    await asUser.mutation(api.eventSeries.cancelOccurrence, {
      seriesId,
      originalStartMs: Date.parse("2026-09-08T07:00:00Z"),
    });

    expect(await drainMail(t)).toEqual([]);
  });
});
