/**
 * The organizer putting themselves on their own series' roster.
 *
 * The one-off event's shortcut, at the level a repeating meeting actually has
 * a roster: one row for the ritual, not one per Tuesday (ADR 0002). Its
 * counterpart is `calendarEvents.selfInvite.test.ts`, and the rules are the
 * same ones — organizer only, silent, accepted on arrival, idempotent, and
 * inside the cap.
 *
 * Why it is opt-in rather than automatic is a graph question, not a guest-list
 * one, and is pinned in `eventSeries.inviteEdges.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { deliveredPushes, resetDeliveredPushes } from "./pushProbe";

const sendEmail = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: (payload: unknown, options?: unknown) => sendEmail(payload, options),
    };
  },
}));

vi.mock("../convex/utils/sendPushToUsers", async () => {
  const probe = await import("./pushProbe");
  return probe.pushDeliveryMock();
});

type T = ReturnType<typeof createTestContext>;

/** Tuesday 1 September 2026, 09:00–09:30 Rome — the standup the rest of the
 *  series suite meets in. */
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

/** The roster cap, mirrored from `eventSeries.ts` — it is module-private
 *  there, and the message the organizer is shown quotes it. */
const MAX_INVITEES = 200;

describe("an organizer joining their own series", () => {
  let t: T;
  beforeEach(() => {
    vi.useFakeTimers();
    resetDeliveredPushes();
    sendEmail.mockClear();
    t = createTestContext();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lands on the roster already accepted", async () => {
    const {
      userId: organizerId,
      workspaceId,
      asUser: organizer,
    } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    // Not on it until they ask: creating the series wrote no roster row.
    expect(
      await organizer.query(api.eventSeries.listInvitees, { seriesId }),
    ).toHaveLength(0);

    await organizer.mutation(api.eventSeries.selfInvite, { seriesId });

    const roster = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });
    expect(roster).toHaveLength(1);
    expect(roster[0]?.userId).toBe(organizerId);
    // Accepted the moment it exists: there is no invitation to answer when you
    // are the one who called the meeting.
    expect(roster[0]?.status).toBe("accepted");
    expect(roster[0]?.respondedAt).toBeTypeOf("number");
    // No guest share — this is a member row, and it is the organizer's own.
    expect(roster[0]?.shareId).toBeUndefined();
    // Filed under the series, never under one occurrence of it.
    expect(roster[0]?.originalStartMs).toBeUndefined();
  });

  it("tells nobody, the organizer included", async () => {
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await organizer.mutation(api.eventSeries.selfInvite, { seriesId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // An invitation is a question, and this is not one: the organizer already
    // knows about the meeting they called, and there is nobody else to inform
    // that its own author is attending it.
    expect(deliveredPushes).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("changes nothing when clicked a second time", async () => {
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await organizer.mutation(api.eventSeries.selfInvite, { seriesId });
    await organizer.mutation(api.eventSeries.selfInvite, { seriesId });

    // A double click is one person on the roster, not two rows for the same
    // person — and no error either, because asking to be somewhere you already
    // are is not a mistake worth interrupting anyone over.
    expect(
      await organizer.query(api.eventSeries.listInvitees, { seriesId }),
    ).toHaveLength(1);
  });

  it("is refused once the roster is full, like any other invitation", async () => {
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    // Fill the roster to the cap. Seeded directly rather than through
    // `addInvitees`, because what is under test is the limit and not the
    // hundreds of invitations it would take to reach it.
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_INVITEES; i++) {
        await ctx.db.insert("eventSeriesInvitees", {
          seriesId,
          workspaceId,
          guestEmail: `guest${i}@outside.test`,
          status: "pending",
        });
      }
    });

    // The shortcut is a seat like any other. Were it not counted, an organizer
    // could fill the roster through the front door and then take one more seat
    // through this one.
    await expect(
      organizer.mutation(api.eventSeries.selfInvite, { seriesId }),
    ).rejects.toThrow(/more than 200 people/);
  });
});

describe("anyone else reaching for the same shortcut", () => {
  let t: T;
  beforeEach(() => {
    vi.useFakeTimers();
    resetDeliveredPushes();
    sendEmail.mockClear();
    t = createTestContext();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cannot let themselves in with it", async () => {
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const { userId: colleagueId, asUser: colleague } =
      await setupAuthenticatedUser(t, { email: "bob@test.com" });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        workspaceId,
        userId: colleagueId,
        role: "member",
      }),
    );

    // A colleague can *see* the series — it is workspace-scoped — and the
    // shortcut is not a second door into its roster. Who attends the standup
    // is the organizer's decision, and self-invite is only the shape it takes
    // when the two are the same person.
    await expect(
      colleague.mutation(api.eventSeries.selfInvite, { seriesId }),
    ).rejects.toThrow(/Only the organizer/);
    expect(
      await organizer.query(api.eventSeries.listInvitees, { seriesId }),
    ).toHaveLength(0);
  });

  it("cannot be used by an organizer who has left the workspace", async () => {
    const {
      userId: organizerId,
      workspaceId,
      asUser: organizer,
    } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    // Offboarded: the membership row is gone, `createdBy` is not.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", organizerId),
        )
        .first();
      if (row) await ctx.db.delete(row._id);
    });

    // The workspace rule first, the organizer narrowing second — so the
    // refusal names the rule that was broken rather than confirming the series
    // exists and how full its roster is.
    await expect(
      organizer.mutation(api.eventSeries.selfInvite, { seriesId }),
    ).rejects.toThrow("Not a member of this workspace");
  });
});
