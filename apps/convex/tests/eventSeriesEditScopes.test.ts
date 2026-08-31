/**
 * The three edit scopes.
 *
 * Every assertion reads the calendar the user actually sees — the union of the
 * events scan and the series expansion — because that is the only vantage
 * point from which "the pattern changed from here onward" and "the pattern
 * changed everywhere" are distinguishable from each other, and from a series
 * that quietly shows every Tuesday twice.
 */
import { describe, it, expect } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
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

/** The Tuesdays of September 2026, as the rule places them. */
const TUESDAYS = [
  Date.parse("2026-09-01T07:00:00Z"),
  Date.parse("2026-09-08T07:00:00Z"),
  Date.parse("2026-09-15T07:00:00Z"),
  Date.parse("2026-09-22T07:00:00Z"),
  Date.parse("2026-09-29T07:00:00Z"),
] as const;

/** Everything on the user's calendar in `window`, as `title @ ISO start`. */
async function calendarEntries(
  asUser: AsUser,
  workspaceId: Id<"workspaces">,
  window: { rangeStartMs: number; rangeEndMs: number } = SEPTEMBER,
): Promise<string[]> {
  const [events, occurrences] = await Promise.all([
    asUser.query(api.calendarEvents.listMineInRange, { workspaceId, ...window }),
    asUser.query(api.eventSeries.listMineInRange, { workspaceId, ...window }),
  ]);
  return [...events, ...occurrences]
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((e) => `${e.title} @ ${new Date(e.startsAt).toISOString()}`);
}

describe("this and following", () => {
  it("renames the chosen occurrence and every later one, and no earlier one", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await asUser.mutation(api.eventSeries.updateFollowing, {
      seriesId,
      originalStartMs: TUESDAYS[2],
      title: "Standup & demo",
    });

    expect(await calendarEntries(asUser, workspaceId)).toEqual([
      "Standup @ 2026-09-01T07:00:00.000Z",
      "Standup @ 2026-09-08T07:00:00.000Z",
      "Standup & demo @ 2026-09-15T07:00:00.000Z",
      "Standup & demo @ 2026-09-22T07:00:00.000Z",
      "Standup & demo @ 2026-09-29T07:00:00.000Z",
    ]);
  });

  it("edits the series in place when the chosen occurrence is its first", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    // Nothing precedes the first occurrence, so there is nothing to truncate
    // and no second resource worth making — this is the whole series.
    const result = await asUser.mutation(api.eventSeries.updateFollowing, {
      seriesId,
      originalStartMs: TUESDAYS[0],
      title: "Standup & demo",
    });

    expect(result).toEqual(seriesId);
    expect(await calendarEntries(asUser, workspaceId)).toEqual([
      "Standup & demo @ 2026-09-01T07:00:00.000Z",
      "Standup & demo @ 2026-09-08T07:00:00.000Z",
      "Standup & demo @ 2026-09-15T07:00:00.000Z",
      "Standup & demo @ 2026-09-22T07:00:00.000Z",
      "Standup & demo @ 2026-09-29T07:00:00.000Z",
    ]);
  });

  it("resets customised occurrences when the in-place edit moves them", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: TUESDAYS[1],
      title: "Standup — retro",
    });

    await asUser.mutation(api.eventSeries.updateFollowing, {
      seriesId,
      originalStartMs: TUESDAYS[0],
      anchorTime: "10:00",
    });

    // Every Tuesday at the new hour and nothing left over at the old one: an
    // override filed under a start the rule no longer produces would show the
    // 8th twice.
    expect(await calendarEntries(asUser, workspaceId)).toEqual([
      "Standup @ 2026-09-01T08:00:00.000Z",
      "Standup @ 2026-09-08T08:00:00.000Z",
      "Standup @ 2026-09-15T08:00:00.000Z",
      "Standup @ 2026-09-22T08:00:00.000Z",
      "Standup @ 2026-09-29T08:00:00.000Z",
    ]);
  });

  it("carries the roster onto the continuation, guests included", async () => {
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
    await asUser.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [colleagueId],
      guestEmails: ["guest@example.com"],
    });

    const continuationId = await asUser.mutation(
      api.eventSeries.updateFollowing,
      { seriesId, originalStartMs: TUESDAYS[2], anchorTime: "09:30" },
    );

    const roster = await asUser.query(api.eventSeries.listInvitees, {
      seriesId: continuationId,
    });
    expect(
      roster.map((r) => r.userId ?? r.guestEmail).sort(),
    ).toEqual([colleagueId, "guest@example.com"].sort());

    // The guest's link is the continuation's own, not the original's — the two
    // series are separate resources and a share points at exactly one.
    const guestShareId = roster.find((r) => r.guestEmail)?.shareId;
    expect(guestShareId).toBeDefined();
    const landing = await t.query(api.eventSeries.getByShareId, {
      shareId: guestShareId!,
    });
    expect(landing.status).toBe("active");
    expect(landing.series?.anchorTime).toBe("09:30");
  });

  it("leaves earlier customised occurrences alone and shows later ones exactly once", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: TUESDAYS[1],
      title: "Standup — retro",
    });
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: TUESDAYS[3],
      startsAt: Date.parse("2026-09-24T07:00:00Z"),
      endsAt: Date.parse("2026-09-24T07:30:00Z"),
    });

    await asUser.mutation(api.eventSeries.updateFollowing, {
      seriesId,
      originalStartMs: TUESDAYS[2],
      title: "Standup & demo",
    });

    // The 22nd's occurrence is still the moved row, still at the time it was
    // moved to, and still appears exactly once: had the split left it filed
    // under the truncated original, the continuation would have produced the
    // 22nd all over again. It keeps its own title, because a content edit
    // never propagates into an override.
    expect(await calendarEntries(asUser, workspaceId)).toEqual([
      "Standup @ 2026-09-01T07:00:00.000Z",
      "Standup — retro @ 2026-09-08T07:00:00.000Z",
      "Standup & demo @ 2026-09-15T07:00:00.000Z",
      "Standup @ 2026-09-24T07:00:00.000Z",
      "Standup & demo @ 2026-09-29T07:00:00.000Z",
    ]);
  });

  it("splits at the last occurrence without inventing a sixth one", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      rule: { ...WEEKLY_STANDUP.rule, end: { kind: "afterCount", count: 5 } },
    });

    await asUser.mutation(api.eventSeries.updateFollowing, {
      seriesId,
      originalStartMs: TUESDAYS[4],
      title: "Standup — last one",
    });

    // Four from the truncated original, one from a continuation whose count
    // is what was left of the original's.
    expect(await calendarEntries(asUser, workspaceId)).toEqual([
      "Standup @ 2026-09-01T07:00:00.000Z",
      "Standup @ 2026-09-08T07:00:00.000Z",
      "Standup @ 2026-09-15T07:00:00.000Z",
      "Standup @ 2026-09-22T07:00:00.000Z",
      "Standup — last one @ 2026-09-29T07:00:00.000Z",
    ]);
    expect(
      await calendarEntries(asUser, workspaceId, {
        rangeStartMs: Date.parse("2026-10-01T00:00:00Z"),
        rangeEndMs: Date.parse("2026-11-01T00:00:00Z"),
      }),
    ).toEqual([]);
  });

  it("resets the customised occurrences it moves, and only those", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: TUESDAYS[1],
      title: "Standup — retro",
    });
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: TUESDAYS[3],
      startsAt: Date.parse("2026-09-24T07:00:00Z"),
      endsAt: Date.parse("2026-09-24T07:30:00Z"),
    });

    // What the confirmation states: one customised occurrence from here on.
    expect(
      await asUser.query(api.eventSeries.countOverrides, {
        seriesId,
        fromOriginalStartMs: TUESDAYS[2],
      }),
    ).toBe(1);

    await asUser.mutation(api.eventSeries.updateFollowing, {
      seriesId,
      originalStartMs: TUESDAYS[2],
      anchorTime: "10:00",
    });

    // The retro keeps its name and its old time — the split did not reach it.
    // The moved 22nd is gone: the start it was filed under is not where the
    // continuation's rule puts anything, so leaving it would have shown that
    // week twice.
    expect(await calendarEntries(asUser, workspaceId)).toEqual([
      "Standup @ 2026-09-01T07:00:00.000Z",
      "Standup — retro @ 2026-09-08T07:00:00.000Z",
      "Standup @ 2026-09-15T08:00:00.000Z",
      "Standup @ 2026-09-22T08:00:00.000Z",
      "Standup @ 2026-09-29T08:00:00.000Z",
    ]);
  });
});

describe("all occurrences, content edit", () => {
  it("renames every occurrence and leaves a customised one showing its old name", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: TUESDAYS[1],
      title: "Standup — retro",
    });

    await asUser.mutation(api.eventSeries.updateSeries, {
      seriesId,
      title: "Daily sync",
    });

    // The renamed Tuesday keeps its own name. That is the accepted, documented
    // behaviour: a content edit does not reach into an override, because an
    // override is a full row that stopped tracking the series.
    expect(await calendarEntries(asUser, workspaceId)).toEqual([
      "Daily sync @ 2026-09-01T07:00:00.000Z",
      "Standup — retro @ 2026-09-08T07:00:00.000Z",
      "Daily sync @ 2026-09-15T07:00:00.000Z",
      "Daily sync @ 2026-09-22T07:00:00.000Z",
      "Daily sync @ 2026-09-29T07:00:00.000Z",
    ]);
  });
});

describe("all occurrences, rule edit", () => {
  it("says how many customised occurrences it will reset, then resets them", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: TUESDAYS[1],
      title: "Standup — retro",
    });
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: TUESDAYS[3],
      startsAt: Date.parse("2026-09-24T07:00:00Z"),
      endsAt: Date.parse("2026-09-24T07:30:00Z"),
    });

    // What the confirmation states, before anything is written.
    expect(
      await asUser.query(api.eventSeries.countOverrides, { seriesId }),
    ).toBe(2);

    await asUser.mutation(api.eventSeries.updateSeries, {
      seriesId,
      anchorTime: "10:00",
    });

    // Every Tuesday at the new hour, and neither customisation survives: the
    // original starts they were filed under are not where the rule puts an
    // occurrence any more.
    expect(await calendarEntries(asUser, workspaceId)).toEqual([
      "Standup @ 2026-09-01T08:00:00.000Z",
      "Standup @ 2026-09-08T08:00:00.000Z",
      "Standup @ 2026-09-15T08:00:00.000Z",
      "Standup @ 2026-09-22T08:00:00.000Z",
      "Standup @ 2026-09-29T08:00:00.000Z",
    ]);
    expect(
      await asUser.query(api.eventSeries.countOverrides, { seriesId }),
    ).toBe(0);
  });
});

describe("an edit that changes nothing about the pattern", () => {
  it("does not reset anyone's customised occurrences", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: TUESDAYS[1],
      title: "Standup — retro",
    });

    // A form hands back every field it holds, the untouched ones included —
    // and the same rule written out again is not a rule change.
    await asUser.mutation(api.eventSeries.updateSeries, {
      seriesId,
      title: "Daily sync",
      anchorDate: WEEKLY_STANDUP.anchorDate,
      anchorTime: WEEKLY_STANDUP.anchorTime,
      durationMs: WEEKLY_STANDUP.durationMs,
      timezone: WEEKLY_STANDUP.timezone,
      rule: {
        end: { kind: "never" },
        weekdays: ["tuesday"],
        interval: 1,
        freq: "weekly",
      },
    });

    expect(await calendarEntries(asUser, workspaceId)).toEqual([
      "Daily sync @ 2026-09-01T07:00:00.000Z",
      "Standup — retro @ 2026-09-08T07:00:00.000Z",
      "Daily sync @ 2026-09-15T07:00:00.000Z",
      "Daily sync @ 2026-09-22T07:00:00.000Z",
      "Daily sync @ 2026-09-29T07:00:00.000Z",
    ]);
  });
});

describe("who may edit the pattern", () => {
  it("refuses a colleague and an outsider on both wider scopes", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const { userId: colleagueId, asUser: colleague } =
      await setupAuthenticatedUser(t, { email: "colleague@example.com" });
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

    const following = { seriesId, originalStartMs: TUESDAYS[2], title: "Mine" };
    const all = { seriesId, title: "Mine" };

    await expect(
      colleague.mutation(api.eventSeries.updateFollowing, following),
    ).rejects.toThrow(/Only the organizer/);
    await expect(
      colleague.mutation(api.eventSeries.updateSeries, all),
    ).rejects.toThrow(/Only the organizer/);
    await expect(
      outsider.mutation(api.eventSeries.updateFollowing, following),
    ).rejects.toThrow();
    await expect(
      outsider.mutation(api.eventSeries.updateSeries, all),
    ).rejects.toThrow();

    expect(await calendarEntries(asUser, workspaceId)).toEqual([
      "Standup @ 2026-09-01T07:00:00.000Z",
      "Standup @ 2026-09-08T07:00:00.000Z",
      "Standup @ 2026-09-15T07:00:00.000Z",
      "Standup @ 2026-09-22T07:00:00.000Z",
      "Standup @ 2026-09-29T07:00:00.000Z",
    ]);
  });
});
