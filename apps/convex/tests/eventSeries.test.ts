import { describe, it, expect } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

type T = ReturnType<typeof createTestContext>;

/** Tuesday 1 September 2026, 09:00–09:30 Rome. Rome is UTC+2 that month. */
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

const SEPTEMBER = {
  rangeStartMs: Date.parse("2026-09-01T00:00:00Z"),
  rangeEndMs: Date.parse("2026-10-01T00:00:00Z"),
};

async function startsInSeptember(
  t: T,
  asUser: ReturnType<typeof setupWorkspaceWithAdmin> extends Promise<infer R>
    ? R extends { asUser: infer A }
      ? A
      : never
    : never,
  workspaceId: Id<"workspaces">,
): Promise<string[]> {
  const occurrences = await (
    asUser as { query: (ref: unknown, args: unknown) => Promise<unknown> }
  ).query(api.eventSeries.listMineInRange, { workspaceId, ...SEPTEMBER });
  return (occurrences as Array<{ startsAt: number }>).map((o) =>
    new Date(o.startsAt).toISOString(),
  );
}

describe("creating a series and seeing its occurrences", () => {
  it("shows an occurrence on every matching date, without storing any of them", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    expect(await startsInSeptember(t, asUser, workspaceId)).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-08T07:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
      "2026-09-22T07:00:00.000Z",
      "2026-09-29T07:00:00.000Z",
    ]);

    // The occurrences are computed, so nothing was written to the events table.
    const events = await t.run((ctx) => ctx.db.query("calendarEvents").collect());
    expect(events).toHaveLength(0);
  });
});

describe("occurrences beyond the first window", () => {
  it("keeps producing them months later, with no upper page to fall off", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(api.eventSeries.create, { workspaceId, ...WEEKLY_STANDUP });

    // Rome leaves CEST for CET on 25 October, so the December occurrences are
    // an hour later in UTC than the September ones — the wall clock holds.
    const december = await asUser.query(api.eventSeries.listMineInRange, {
      workspaceId,
      rangeStartMs: Date.parse("2026-12-01T00:00:00Z"),
      rangeEndMs: Date.parse("2027-01-01T00:00:00Z"),
    });

    expect(december.map((o) => new Date(o.startsAt).toISOString())).toEqual([
      "2026-12-01T08:00:00.000Z",
      "2026-12-08T08:00:00.000Z",
      "2026-12-15T08:00:00.000Z",
      "2026-12-22T08:00:00.000Z",
      "2026-12-29T08:00:00.000Z",
    ]);
  });

  it("places a series anchored in another timezone at its own local time", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      title: "Tokyo sync",
      anchorDate: "2026-09-02",
      anchorTime: "09:00",
      durationMs: 30 * 60 * 1000,
      timezone: "Asia/Tokyo",
      rule: {
        freq: "weekly",
        interval: 1,
        weekdays: ["wednesday"],
        end: { kind: "afterCount", count: 2 },
      },
    });

    // Tokyo is UTC+9 year-round: 09:00 local is 00:00Z, whoever is looking.
    const occurrences = await asUser.query(api.eventSeries.listMineInRange, {
      workspaceId,
      ...SEPTEMBER,
    });
    expect(occurrences.map((o) => new Date(o.startsAt).toISOString())).toEqual([
      "2026-09-02T00:00:00.000Z",
      "2026-09-09T00:00:00.000Z",
    ]);
  });

  it("stops producing them once the series has ended", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      rule: { ...WEEKLY_STANDUP.rule, end: { kind: "afterCount", count: 2 } },
    });

    expect(await startsInSeptember(t, asUser, workspaceId)).toHaveLength(2);
    const october = await asUser.query(api.eventSeries.listMineInRange, {
      workspaceId,
      rangeStartMs: Date.parse("2026-10-01T00:00:00Z"),
      rangeEndMs: Date.parse("2026-11-01T00:00:00Z"),
    });
    expect(october).toEqual([]);
  });
});

describe("who may see a series", () => {
  it("refuses someone who is not a member of the workspace", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const { asUser: outsider } = await setupAuthenticatedUser(t, { email: "outsider@example.com" });

    await expect(
      outsider.query(api.eventSeries.listMineInRange, { workspaceId, ...SEPTEMBER }),
    ).rejects.toThrow();
    expect(await outsider.query(api.eventSeries.get, { seriesId })).toBeNull();
  });

  it("keeps a colleague's series out of my own lane", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(api.eventSeries.create, { workspaceId, ...WEEKLY_STANDUP });

    const { userId: colleagueId, asUser: colleague } = await setupAuthenticatedUser(t, { email: "colleague@example.com" });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: colleagueId,
        workspaceId,
        role: "member",
      }),
    );

    // A workspace member reaches the series itself (the workspace rule), but
    // it is not on their calendar until they are invited to it.
    expect(
      await colleague.query(api.eventSeries.listMineInRange, {
        workspaceId,
        ...SEPTEMBER,
      }),
    ).toEqual([]);
  });
});

describe("the availability overlay", () => {
  it("shows a colleague's series as busy blocks and says nothing about them", async () => {
    const t = createTestContext();
    const { workspaceId, userId: ownerId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(api.eventSeries.create, { workspaceId, ...WEEKLY_STANDUP });

    const { userId: viewerId, asUser: viewer } = await setupAuthenticatedUser(t, { email: "viewer@example.com" });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: viewerId,
        workspaceId,
        role: "member",
      }),
    );

    const blocks = await viewer.query(api.eventSeries.listForMembersInRange, {
      workspaceId,
      memberIds: [ownerId],
      ...SEPTEMBER,
    });

    expect(blocks).toHaveLength(5);
    // Timing and who — and nothing else. A curious colleague learns that the
    // owner is booked, never what by.
    expect(Object.keys(blocks[0]!).sort()).toEqual(["endsAt", "memberId", "startsAt"]);
    expect(blocks.every((b) => b.memberId === ownerId)).toBe(true);
  });

  it("returns nothing for someone outside the workspace", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(api.eventSeries.create, { workspaceId, ...WEEKLY_STANDUP });

    const { userId: strangerId } = await setupAuthenticatedUser(t, { email: "stranger@example.com" });
    const { userId: viewerId, asUser: viewer } = await setupAuthenticatedUser(t, { email: "viewer2@example.com" });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: viewerId,
        workspaceId,
        role: "member",
      }),
    );

    expect(
      await viewer.query(api.eventSeries.listForMembersInRange, {
        workspaceId,
        memberIds: [strangerId],
        ...SEPTEMBER,
      }),
    ).toEqual([]);
  });
});

describe("limits at save time", () => {
  it("refuses a series that would run longer than a series may run", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    await expect(
      asUser.mutation(api.eventSeries.create, {
        workspaceId,
        ...WEEKLY_STANDUP,
        rule: {
          ...WEEKLY_STANDUP.rule,
          end: { kind: "onDate", date: "2040-09-01" },
        },
      }),
    ).rejects.toThrow(/10 years/);
  });

  it("refuses a repeat that could never place an occurrence", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    await expect(
      asUser.mutation(api.eventSeries.create, {
        workspaceId,
        ...WEEKLY_STANDUP,
        rule: { ...WEEKLY_STANDUP.rule, weekdays: [] },
      }),
    ).rejects.toThrow(/at least one weekday/);
  });

  it("holds the same 24-hour duration cap a one-off event holds", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    await expect(
      asUser.mutation(api.eventSeries.create, {
        workspaceId,
        ...WEEKLY_STANDUP,
        durationMs: 25 * 60 * 60 * 1000,
      }),
    ).rejects.toThrow(/24 hours/);
  });

  it("refuses a window too dense to serve rather than truncating it", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      rule: { freq: "daily", interval: 1, end: { kind: "never" } },
    });

    await expect(
      asUser.query(api.eventSeries.listMineInRange, {
        workspaceId,
        rangeStartMs: Date.parse("2026-09-01T00:00:00Z"),
        rangeEndMs: Date.parse("2029-09-01T00:00:00Z"),
      }),
    ).rejects.toThrow(/more than 366 occurrences/);
  });
});

describe("how a series ends", () => {
  it("keeps whichever of the three ends the organizer chose, on reopening", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    for (const end of [
      { kind: "never" as const },
      { kind: "onDate" as const, date: "2026-12-01" },
      { kind: "afterCount" as const, count: 6 },
    ]) {
      const seriesId = await asUser.mutation(api.eventSeries.create, {
        workspaceId,
        ...WEEKLY_STANDUP,
        rule: { ...WEEKLY_STANDUP.rule, end },
      });

      const reopened = await asUser.query(api.eventSeries.get, { seriesId });
      expect(reopened?.rule.end).toEqual(end);
    }
  });

  it("gives a series that never ends occurrences years out, with nothing to renew", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(api.eventSeries.create, { workspaceId, ...WEEKLY_STANDUP });

    // Well past any horizon a single read is bounded by: the series itself is
    // open-ended, so the organizer is never asked to extend it.
    const yearsLater = await asUser.query(api.eventSeries.listMineInRange, {
      workspaceId,
      rangeStartMs: Date.parse("2031-09-01T00:00:00Z"),
      rangeEndMs: Date.parse("2031-10-01T00:00:00Z"),
    });
    expect(yearsLater.map((o) => new Date(o.startsAt).toISOString())).toEqual([
      "2031-09-02T07:00:00.000Z",
      "2031-09-09T07:00:00.000Z",
      "2031-09-16T07:00:00.000Z",
      "2031-09-23T07:00:00.000Z",
      "2031-09-30T07:00:00.000Z",
    ]);
  });
});

describe("one-off events", () => {
  it("are untouched by any of this", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId,
      title: "One-off",
      startsAt: Date.parse("2026-09-03T09:00:00Z"),
      endsAt: Date.parse("2026-09-03T09:30:00Z"),
      timezone: "Europe/Rome",
      invitees: { userIds: [], guestEmails: [] },
    });

    const events = await asUser.query(api.calendarEvents.listMineInRange, {
      workspaceId,
      ...SEPTEMBER,
    });
    expect(events.map((e) => e._id)).toEqual([eventId]);

    // The event's row carries no series coordinate, and the series query does
    // not see it — the two lanes never overlap.
    const row = await t.run((ctx) => ctx.db.get(eventId));
    expect(row?.seriesId).toBeUndefined();
    expect(row?.originalStartMs).toBeUndefined();
    expect(
      await asUser.query(api.eventSeries.listMineInRange, { workspaceId, ...SEPTEMBER }),
    ).toEqual([]);
  });
});
