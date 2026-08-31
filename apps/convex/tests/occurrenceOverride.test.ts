/**
 * One Tuesday differs from the pattern.
 *
 * The calendar the user sees is the union of two queries — the events scan and
 * the series expansion — so every assertion here reads that union rather than
 * either half of it. That is the only vantage point from which "moved" and
 * "appears twice" are distinguishable.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  channelFields,
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

type AsUser = Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["asUser"];

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

const OCTOBER = {
  rangeStartMs: Date.parse("2026-10-01T00:00:00Z"),
  rangeEndMs: Date.parse("2026-11-01T00:00:00Z"),
};

/** The second Tuesday of September, as the rule places it. */
const SECOND_TUESDAY = Date.parse("2026-09-08T07:00:00Z");

/**
 * Everything on the user's calendar in `window`, as ISO starts — the events
 * lane and the series lane merged the way the dashboard merges them.
 */
async function calendarStarts(
  asUser: AsUser,
  workspaceId: Id<"workspaces">,
  window: { rangeStartMs: number; rangeEndMs: number },
): Promise<string[]> {
  const [events, occurrences] = await Promise.all([
    asUser.query(api.calendarEvents.listMineInRange, { workspaceId, ...window }),
    asUser.query(api.eventSeries.listMineInRange, { workspaceId, ...window }),
  ]);
  return [...events, ...occurrences]
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((e) => new Date(e.startsAt).toISOString());
}

/** The same union, as `title @ ISO start` pairs. */
async function calendarEntries(
  asUser: AsUser,
  workspaceId: Id<"workspaces">,
  window: { rangeStartMs: number; rangeEndMs: number },
): Promise<string[]> {
  const [events, occurrences] = await Promise.all([
    asUser.query(api.calendarEvents.listMineInRange, { workspaceId, ...window }),
    asUser.query(api.eventSeries.listMineInRange, { workspaceId, ...window }),
  ]);
  return [...events, ...occurrences]
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((e) => `${e.title} @ ${new Date(e.startsAt).toISOString()}`);
}

describe("moving one occurrence", () => {
  it("shows it at its new time and leaves every other occurrence where it was", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
      startsAt: Date.parse("2026-09-08T09:00:00Z"),
      endsAt: Date.parse("2026-09-08T09:30:00Z"),
    });

    expect(await calendarStarts(asUser, workspaceId, SEPTEMBER)).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-08T09:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
      "2026-09-22T07:00:00.000Z",
      "2026-09-29T07:00:00.000Z",
    ]);
  });
});

describe("an occurrence moved out of the window it came from", () => {
  it("leaves its old window and appears exactly once in its new one", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    // The last Tuesday of September, pushed a week and a bit into October.
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: Date.parse("2026-09-29T07:00:00Z"),
      startsAt: Date.parse("2026-10-06T11:00:00Z"),
      endsAt: Date.parse("2026-10-06T11:30:00Z"),
    });

    expect(await calendarStarts(asUser, workspaceId, SEPTEMBER)).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-08T07:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
      "2026-09-22T07:00:00.000Z",
    ]);

    // October keeps its own four Tuesdays (the last one an hour later in UTC,
    // because Rome leaves summer time on the 25th) and gains the moved one.
    expect(await calendarStarts(asUser, workspaceId, OCTOBER)).toEqual([
      "2026-10-06T07:00:00.000Z",
      "2026-10-06T11:00:00.000Z",
      "2026-10-13T07:00:00.000Z",
      "2026-10-20T07:00:00.000Z",
      "2026-10-27T08:00:00.000Z",
    ]);
  });
});

describe("renaming one occurrence", () => {
  it("changes that occurrence's title and no other's", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
      title: "Standup — quarterly review",
      description: "Numbers this week.",
    });

    expect(await calendarEntries(asUser, workspaceId, SEPTEMBER)).toEqual([
      "Standup @ 2026-09-01T07:00:00.000Z",
      "Standup — quarterly review @ 2026-09-08T07:00:00.000Z",
      "Standup @ 2026-09-15T07:00:00.000Z",
      "Standup @ 2026-09-22T07:00:00.000Z",
      "Standup @ 2026-09-29T07:00:00.000Z",
    ]);
  });
});

describe("cancelling one occurrence", () => {
  it("takes it off the calendar and leaves the series and the rest standing", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await asUser.mutation(api.eventSeries.cancelOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
    });

    expect(await calendarStarts(asUser, workspaceId, SEPTEMBER)).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
      "2026-09-22T07:00:00.000Z",
      "2026-09-29T07:00:00.000Z",
    ]);
    expect(await asUser.query(api.eventSeries.get, { seriesId })).not.toBeNull();
  });

  it("costs no row of any kind", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await asUser.mutation(api.eventSeries.cancelOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
    });

    expect(await t.run((ctx) => ctx.db.query("calendarEvents").collect())).toEqual([]);
  });

  it("cancels an occurrence that had already been moved", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
      startsAt: Date.parse("2026-09-10T07:00:00Z"),
      endsAt: Date.parse("2026-09-10T07:30:00Z"),
    });
    await asUser.mutation(api.eventSeries.cancelOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
    });

    // Gone from where the rule put it *and* from where it was moved to.
    expect(await calendarStarts(asUser, workspaceId, SEPTEMBER)).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
      "2026-09-22T07:00:00.000Z",
      "2026-09-29T07:00:00.000Z",
    ]);
  });
});

describe("cancelling a moved occurrence from the event surface", () => {
  it("does not let the rule put it back where it started", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    // Once moved, the occurrence is an ordinary-looking event row, and the
    // event detail page's "Cancel event" is the button in front of the user.
    const overrideId = await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
      startsAt: Date.parse("2026-09-10T07:00:00Z"),
      endsAt: Date.parse("2026-09-10T07:30:00Z"),
    });

    await asUser.mutation(api.calendarEvents.cancel, { eventId: overrideId });

    expect(await calendarStarts(asUser, workspaceId, SEPTEMBER)).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
      "2026-09-22T07:00:00.000Z",
      "2026-09-29T07:00:00.000Z",
    ]);
  });
});

describe("an override is not a resource", () => {
  it("produces no graph node, where an ordinary event produces one", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await t.run((ctx) =>
      ctx.db.insert("channels", {
        workspaceId,
        name: "standup",
        ...channelFields("open"),
      }),
    );

    const oneOffId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId,
      title: "Kickoff",
      startsAt: Date.parse("2026-09-03T09:00:00Z"),
      endsAt: Date.parse("2026-09-03T09:30:00Z"),
      timezone: "Europe/Rome",
      channelId,
      invitees: { userIds: [], guestEmails: [] },
    });
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      channelId,
    });
    const overrideId = await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
      startsAt: Date.parse("2026-09-08T09:00:00Z"),
      endsAt: Date.parse("2026-09-08T09:30:00Z"),
    });

    const graph = await asUser.query(api.graph.getWorkspaceGraph, { workspaceId });
    const eventNodes = graph.nodes
      .filter((n) => n.type === "calendarEvent")
      .map((n) => n.id);

    // The one-off is in the graph; the override — a row in the very same table,
    // written through the very same trigger — is not. Delete the condition in
    // the `calendarEvents` node trigger and this fails.
    expect(eventNodes).toEqual([oneOffId]);
    expect(eventNodes).not.toContain(overrideId);
  });

  it("is hosted in a channel without leaving an edge behind", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await t.run((ctx) =>
      ctx.db.insert("channels", {
        workspaceId,
        name: "standup",
        ...channelFields("open"),
      }),
    );
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      channelId,
    });
    const overrideId = await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
      startsAt: Date.parse("2026-09-08T09:00:00Z"),
      endsAt: Date.parse("2026-09-08T09:30:00Z"),
    });

    // Read directly, because an edge hanging off a node that does not exist is
    // precisely what no query can show you: `getWorkspaceGraph` drops any link
    // whose endpoints it cannot resolve, so the orphan would be invisible right
    // up until something else went looking for it.
    const edges = await t.run((ctx) => ctx.db.query("edges").collect());
    expect(edges.filter((e) => e.sourceId === overrideId)).toEqual([]);
  });

  it("cannot be given a roster of its own", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: colleagueId } = await setupAuthenticatedUser(t, {
      email: "colleague@example.com",
    });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: colleagueId,
        workspaceId,
        role: "member",
      }),
    );

    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    const overrideId = await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
      startsAt: Date.parse("2026-09-08T09:00:00Z"),
      endsAt: Date.parse("2026-09-08T09:30:00Z"),
    });

    // The roster belongs to the series. An override's id reaching the one-off
    // invite path would file a roster under a row that is not a resource, and
    // the invitee trigger would then write an `invites` edge out of a node
    // that was never created.
    await expect(
      asUser.mutation(api.calendarEvents.addInvitees, {
        eventId: overrideId,
        userIds: [colleagueId],
        guestEmails: [],
      }),
    ).rejects.toThrow(/series/i);

    // The organizer's own shortcut writes into the same table through the same
    // trigger, so it is the same hole and closes the same way.
    await expect(
      asUser.mutation(api.calendarEvents.selfInvite, { eventId: overrideId }),
    ).rejects.toThrow(/series/i);

    expect(
      await t.run((ctx) => ctx.db.query("calendarEventInvitees").collect()),
    ).toEqual([]);
    const edges = await t.run((ctx) => ctx.db.query("edges").collect());
    expect(edges.filter((e) => e.sourceId === overrideId)).toEqual([]);
  });

  it("appears in no @-mention autocomplete result, searched or browsed", async () => {
    // Autocomplete's browse mode is a window around *now*, so the clock has to
    // sit inside the month the fixtures live in.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T00:00:00Z"));

    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const oneOffId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId,
      title: "Standup planning",
      startsAt: Date.parse("2026-09-03T09:00:00Z"),
      endsAt: Date.parse("2026-09-03T09:30:00Z"),
      timezone: "Europe/Rome",
      invitees: { userIds: [], guestEmails: [] },
    });
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
      startsAt: Date.parse("2026-09-08T09:00:00Z"),
      endsAt: Date.parse("2026-09-08T09:30:00Z"),
    });

    // The override's title is the series' own, so an unfiltered `by_title`
    // search offers "Standup" as if it were a thing you could mention. Delete
    // the condition in `listForMentionAutocomplete` and this fails.
    const searched = await asUser.query(api.calendarEvents.listForMentionAutocomplete, {
      workspaceId,
      query: "Standup",
    });
    expect(searched.map((s) => s.eventId)).toEqual([oneOffId]);

    const browsed = await asUser.query(api.calendarEvents.listForMentionAutocomplete, {
      workspaceId,
    });
    expect(browsed.map((s) => s.eventId)).toEqual([oneOffId]);
  });
});

describe("who may edit one occurrence", () => {
  it("refuses a colleague and an outsider alike", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const { userId: colleagueId, asUser: colleague } = await setupAuthenticatedUser(
      t,
      { email: "colleague@example.com" },
    );
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: colleagueId,
        workspaceId,
        role: "member",
      }),
    );
    const { asUser: outsider } = await setupAuthenticatedUser(t, {
      email: "outsider@example.com",
    });

    const move = { seriesId, originalStartMs: SECOND_TUESDAY, startsAt: 1, endsAt: 2 };
    const skip = { seriesId, originalStartMs: SECOND_TUESDAY };

    // A workspace member reaches the series — the workspace rule — but only
    // the organizer rewrites it, exactly as for a one-off event.
    await expect(
      colleague.mutation(api.eventSeries.updateOccurrence, move),
    ).rejects.toThrow(/Only the organizer/);
    await expect(
      colleague.mutation(api.eventSeries.cancelOccurrence, skip),
    ).rejects.toThrow(/Only the organizer/);
    await expect(
      outsider.mutation(api.eventSeries.updateOccurrence, move),
    ).rejects.toThrow();
    await expect(
      outsider.mutation(api.eventSeries.cancelOccurrence, skip),
    ).rejects.toThrow();

    // Nothing was written by any of them.
    expect(await t.run((ctx) => ctx.db.query("calendarEvents").collect())).toEqual([]);
    expect(await calendarStarts(asUser, workspaceId, SEPTEMBER)).toHaveLength(5);
  });
});

describe("the excluded-starts cap", () => {
  /** A series already carrying the maximum number of skipped occurrences. */
  async function seriesAtTheCap(t: ReturnType<typeof createTestContext>) {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    const full = Array.from(
      { length: 200 },
      (_, i) => Date.parse("2020-01-07T08:00:00Z") + i * 7 * 24 * 60 * 60 * 1000,
    );
    await t.run((ctx) => ctx.db.patch(seriesId, { excludedStarts: full }));
    return { workspaceId, asUser, seriesId, full };
  }

  it("refuses the cancellation that would exceed it, and names the limit", async () => {
    const t = createTestContext();
    const { asUser, seriesId } = await seriesAtTheCap(t);

    await expect(
      asUser.mutation(api.eventSeries.cancelOccurrence, {
        seriesId,
        originalStartMs: SECOND_TUESDAY,
      }),
    ).rejects.toThrow(/at most 200 occurrences/);
  });

  it("does not count cancelling something already cancelled", async () => {
    const t = createTestContext();
    const { asUser, seriesId, full } = await seriesAtTheCap(t);

    await expect(
      asUser.mutation(api.eventSeries.cancelOccurrence, {
        seriesId,
        originalStartMs: full[0]!,
      }),
    ).resolves.toBeNull();
  });
});

describe("the availability overlay", () => {
  it("shows a moved occurrence at its new time and a cancelled one not at all", async () => {
    const t = createTestContext();
    const {
      workspaceId,
      userId: ownerId,
      asUser: owner,
    } = await setupWorkspaceWithAdmin(t);
    const seriesId = await owner.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await owner.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: SECOND_TUESDAY,
      startsAt: Date.parse("2026-09-08T13:00:00Z"),
      endsAt: Date.parse("2026-09-08T13:30:00Z"),
    });
    await owner.mutation(api.eventSeries.cancelOccurrence, {
      seriesId,
      originalStartMs: Date.parse("2026-09-22T07:00:00Z"),
    });

    const { userId: viewerId, asUser: viewer } = await setupAuthenticatedUser(t, {
      email: "viewer@example.com",
    });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: viewerId,
        workspaceId,
        role: "member",
      }),
    );

    const [eventBlocks, seriesBlocks] = await Promise.all([
      viewer.query(api.calendarEvents.listForMembersInRange, {
        workspaceId,
        memberIds: [ownerId],
        ...SEPTEMBER,
      }),
      viewer.query(api.eventSeries.listForMembersInRange, {
        workspaceId,
        memberIds: [ownerId],
        ...SEPTEMBER,
      }),
    ]);
    const blocks = [...eventBlocks, ...seriesBlocks].sort(
      (a, b) => a.startsAt - b.startsAt,
    );

    expect(blocks.map((b) => new Date(b.startsAt).toISOString())).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-08T13:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
      "2026-09-29T07:00:00.000Z",
    ]);
    // Still only when, never what.
    expect(Object.keys(blocks[1]!).sort()).toEqual([
      "endsAt",
      "memberId",
      "startsAt",
    ]);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
