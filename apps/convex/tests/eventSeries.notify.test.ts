/**
 * Who hears about a change to a repeating meeting, and when nobody does.
 *
 * The rule under test is one sentence: an edit is worth an interruption only
 * when it changes somebody's plans. So a change reaching a future occurrence
 * notifies the roster, and a change every one of whose occurrences has already
 * happened notifies nobody — whatever scope it was made at, and even when the
 * caller asked for notification. The organizer tidying last quarter's standups
 * does not mail the team (spec 0003, user story 21).
 *
 * The observable is what reached push delivery — see `pushProbe.ts`. The guest
 * ICS mail is a separate lane and is not asserted here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { deliveredPushes, resetDeliveredPushes } from "./pushProbe";

vi.mock("../convex/utils/sendPushToUsers", async () => {
  const probe = await import("./pushProbe");
  return probe.pushDeliveryMock();
});

type TestContext = ReturnType<typeof createTestContext>;

/** Tuesday 09:00–09:30 Rome, weekly, from 1 September 2026 for six weeks. */
const STANDUP = {
  title: "Standup",
  anchorDate: "2026-09-01",
  anchorTime: "09:00",
  durationMs: 30 * 60 * 1000,
  timezone: "Europe/Rome",
  rule: {
    freq: "weekly" as const,
    interval: 1,
    weekdays: ["tuesday"],
    end: { kind: "afterCount" as const, count: 6 },
  },
};

const SEPT_1 = Date.parse("2026-09-01T07:00:00Z");
const SEPT_15 = Date.parse("2026-09-15T07:00:00Z");
const SEPT_22 = Date.parse("2026-09-22T07:00:00Z");
const OCT_6 = Date.parse("2026-10-06T07:00:00Z");

describe("telling the roster about a change to a series", () => {
  let t: TestContext;
  beforeEach(() => {
    vi.useFakeTimers();
    resetDeliveredPushes();
    t = createTestContext();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A standup with one colleague on its roster, and the clock pinned. */
  async function standupWithOneInvitee(nowIso: string) {
    vi.setSystemTime(new Date(nowIso));
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: inviteeId } = await setupAuthenticatedUser(t, {
      email: "colleague@example.com",
    });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: inviteeId,
        workspaceId,
        role: "member",
      }),
    );
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...STANDUP,
    });
    await asUser.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [inviteeId],
      guestEmails: [],
    });
    // Drain the invitation before resetting, or it lands in the pool and is
    // delivered by the first drain the assertions do.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    resetDeliveredPushes();
    return { workspaceId, asUser, seriesId, inviteeId };
  }

  /** Drain the pool and report what reached push delivery since the reset. */
  async function pushesSent(): Promise<typeof deliveredPushes> {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return deliveredPushes;
  }

  it("tells the roster when one occurrence still ahead is moved", async () => {
    // Standing before the series starts: 15 September is somebody's plan.
    const { asUser, seriesId, inviteeId } = await standupWithOneInvitee(
      "2026-08-25T00:00:00Z",
    );

    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SEPT_15,
      startsAt: SEPT_15 + 60 * 60 * 1000,
      endsAt: SEPT_15 + 90 * 60 * 1000,
      notifyInvitees: true,
    });

    const sent = await pushesSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.recipientIds).toEqual([String(inviteeId)]);
  });

  it("says nothing when a past occurrence is shuffled to another past time", async () => {
    // Standing after the series has finished: this is housekeeping, and the
    // organizer asking for notification does not make it news.
    const { asUser, seriesId } = await standupWithOneInvitee(
      "2026-12-01T00:00:00Z",
    );

    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SEPT_15,
      startsAt: SEPT_15 + 60 * 60 * 1000,
      endsAt: SEPT_15 + 90 * 60 * 1000,
      notifyInvitees: true,
    });

    expect(await pushesSent()).toEqual([]);
  });

  it("still applies the change when the organizer declines to notify", async () => {
    const { workspaceId, asUser, seriesId } = await standupWithOneInvitee(
      "2026-08-25T00:00:00Z",
    );

    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SEPT_15,
      startsAt: SEPT_15 + 60 * 60 * 1000,
      endsAt: SEPT_15 + 90 * 60 * 1000,
      notifyInvitees: false,
    });

    expect(await pushesSent()).toEqual([]);
    // "Don't send" is about the mail, never about the edit.
    const occurrences = await asUser.query(api.eventSeries.listMineInRange, {
      workspaceId,
      rangeStartMs: SEPT_15,
      rangeEndMs: SEPT_15 + 24 * 60 * 60 * 1000,
    });
    expect(occurrences).toEqual([]);
    const override = await t.run((ctx) =>
      ctx.db
        .query("calendarEvents")
        .withIndex("by_series_original_start", (q) =>
          q.eq("seriesId", seriesId).eq("originalStartMs", SEPT_15),
        )
        .unique(),
    );
    expect(override?.startsAt).toBe(SEPT_15 + 60 * 60 * 1000);
  });

  it("tells the roster when an occurrence still ahead is skipped", async () => {
    const { asUser, seriesId, inviteeId } = await standupWithOneInvitee(
      "2026-08-25T00:00:00Z",
    );

    await asUser.mutation(api.eventSeries.cancelOccurrence, {
      seriesId,
      originalStartMs: SEPT_15,
      notifyInvitees: true,
    });

    const sent = await pushesSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.recipientIds).toEqual([String(inviteeId)]);
    expect(sent[0]!.title).toBe("Calendar event cancelled");
  });

  it("says nothing when the skipped occurrence has already happened", async () => {
    const { asUser, seriesId } = await standupWithOneInvitee(
      "2026-09-20T00:00:00Z",
    );

    await asUser.mutation(api.eventSeries.cancelOccurrence, {
      seriesId,
      originalStartMs: SEPT_15,
      notifyInvitees: true,
    });

    expect(await pushesSent()).toEqual([]);
  });

  it("tells the roster when 'this and following' reaches occurrences ahead", async () => {
    // Standing between the third and fourth Tuesday: the split point is
    // behind us, but three occurrences after it are not.
    const { asUser, seriesId, inviteeId } = await standupWithOneInvitee(
      "2026-09-16T00:00:00Z",
    );

    await asUser.mutation(api.eventSeries.updateFollowing, {
      seriesId,
      originalStartMs: SEPT_15,
      anchorTime: "09:30",
      notifyInvitees: true,
    });

    const sent = await pushesSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.recipientIds).toEqual([String(inviteeId)]);
  });

  it("says nothing when 'this and following' reaches only finished occurrences", async () => {
    // Standing after the last Tuesday: everything the split touches is over.
    const { asUser, seriesId } = await standupWithOneInvitee(
      "2026-12-01T00:00:00Z",
    );

    await asUser.mutation(api.eventSeries.updateFollowing, {
      seriesId,
      originalStartMs: SEPT_15,
      anchorTime: "09:30",
      notifyInvitees: true,
    });

    expect(await pushesSent()).toEqual([]);
  });

  it("tells the roster when the whole series still has occurrences ahead", async () => {
    const { asUser, seriesId, inviteeId } = await standupWithOneInvitee(
      "2026-09-16T00:00:00Z",
    );

    await asUser.mutation(api.eventSeries.updateSeries, {
      seriesId,
      title: "Standup (now 09:30)",
      anchorTime: "09:30",
      notifyInvitees: true,
    });

    const sent = await pushesSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.recipientIds).toEqual([String(inviteeId)]);
    // A notification about the pattern goes bare: it lands on whichever
    // occurrence is next when the recipient opens it.
    expect(sent[0]!.url).not.toContain("?on=");
  });

  it("says nothing when the whole series is already over", async () => {
    const { asUser, seriesId } = await standupWithOneInvitee(
      "2026-12-01T00:00:00Z",
    );

    await asUser.mutation(api.eventSeries.updateSeries, {
      seriesId,
      title: "Standup (renamed for the archive)",
      notifyInvitees: true,
    });

    expect(await pushesSent()).toEqual([]);
  });

  it("tells the roster when a series with occurrences ahead is deleted", async () => {
    const { asUser, seriesId, inviteeId } = await standupWithOneInvitee(
      "2026-09-16T00:00:00Z",
    );

    await asUser.mutation(api.eventSeries.cancel, {
      seriesId,
      notifyInvitees: true,
    });

    const sent = await pushesSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.recipientIds).toEqual([String(inviteeId)]);
    expect(sent[0]!.title).toBe("Calendar event cancelled");
    // Nothing left to open — the link goes to the calendar, as a cancelled
    // one-off event's does.
    expect(sent[0]!.url).toContain("/dashboard/calendar");
  });

  it("says nothing when the series being deleted is already over", async () => {
    const { asUser, seriesId } = await standupWithOneInvitee(
      "2026-12-01T00:00:00Z",
    );

    await asUser.mutation(api.eventSeries.cancel, {
      seriesId,
      notifyInvitees: true,
    });

    expect(await pushesSent()).toEqual([]);
  });

  it("says nothing when only the series' tags change", async () => {
    // Tags are the organizer's filing, not the meeting. Nothing about anyone's
    // Tuesday changed, so nothing is worth an interruption — and there is no
    // prompt in front of this write to decline either.
    const { asUser, seriesId } = await standupWithOneInvitee(
      "2026-08-25T00:00:00Z",
    );

    await asUser.mutation(api.eventSeries.updateTags, {
      seriesId,
      tags: ["rituals"],
    });

    expect(await pushesSent()).toEqual([]);
  });

  it("carries the roster's size on every occurrence, so the prompt can name it", async () => {
    // Counted once for the series and stamped on each occurrence it produces:
    // the prompt in front of a drag has to say "2 invitees" without a second
    // round trip, and every Tuesday of one standup has the same roster.
    const { workspaceId, asUser, seriesId } = await standupWithOneInvitee(
      "2026-08-25T00:00:00Z",
    );
    const { userId: secondId } = await setupAuthenticatedUser(t, {
      email: "second@example.com",
    });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: secondId,
        workspaceId,
        role: "member",
      }),
    );
    await asUser.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [secondId],
      guestEmails: ["guest@example.com"],
    });

    const occurrences = await asUser.query(api.eventSeries.listMineInRange, {
      workspaceId,
      rangeStartMs: SEPT_1,
      rangeEndMs: OCT_6 + 24 * 60 * 60 * 1000,
    });

    expect(occurrences.length).toBeGreaterThan(1);
    // Two colleagues and one guest; the organizer is not one of their own
    // invitees.
    expect(
      occurrences.map((o) => o.nonOrganizerInviteeCount),
    ).toEqual(occurrences.map(() => 3));
  });
});
