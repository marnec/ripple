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

type T = ReturnType<typeof createTestContext>;

beforeEach(() => {
  vi.useFakeTimers();
  resetDeliveredPushes();
});
afterEach(() => {
  vi.useRealTimers();
});

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

async function addWorkspaceMember(
  t: T,
  workspaceId: Id<"workspaces">,
  email: string,
) {
  const { userId, asUser } = await setupAuthenticatedUser(t, { email });
  await t.run((ctx) =>
    ctx.db.insert("workspaceMembers", { workspaceId, userId, role: "member" }),
  );
  return { userId, asUser };
}

/** Invite one guest and hand back the share id their link is built from. */
async function inviteGuest(
  t: T,
  organizer: { mutation: any; query: any },
  seriesId: Id<"eventSeries">,
  email: string,
): Promise<string> {
  await organizer.mutation(api.eventSeries.addInvitees, {
    seriesId,
    userIds: [],
    guestEmails: [email],
  });
  const roster = (await organizer.query(api.eventSeries.listInvitees, {
    seriesId,
  })) as Array<{ guestEmail?: string; shareId?: string }>;
  return roster.find((r) => r.guestEmail === email)!.shareId!;
}

describe("inviting a member to a series", () => {
  it("puts every occurrence on their calendar, not one of them", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const { userId: memberId, asUser: member } = await addWorkspaceMember(
      t,
      workspaceId,
      "member@example.com",
    );

    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [memberId],
      guestEmails: [],
    });

    const mine = await member.query(api.eventSeries.listMineInRange, {
      workspaceId,
      ...SEPTEMBER,
    });
    expect(mine.map((o) => new Date(o.startsAt).toISOString())).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-08T07:00:00.000Z",
      "2026-09-15T07:00:00.000Z",
      "2026-09-22T07:00:00.000Z",
      "2026-09-29T07:00:00.000Z",
    ]);
  });

  it("refuses someone who is not a member of the workspace", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const { userId: outsiderId } = await setupAuthenticatedUser(t, {
      email: "outsider@example.com",
    });

    await expect(
      organizer.mutation(api.eventSeries.addInvitees, {
        seriesId,
        userIds: [outsiderId],
        guestEmails: [],
      }),
    ).rejects.toThrow(/not a member of this workspace/);
  });

  it("refuses a colleague who did not organize it", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const { asUser: colleague } = await addWorkspaceMember(
      t,
      workspaceId,
      "colleague@example.com",
    );
    const { userId: thirdId } = await addWorkspaceMember(
      t,
      workspaceId,
      "third@example.com",
    );

    await expect(
      colleague.mutation(api.eventSeries.addInvitees, {
        seriesId,
        userIds: [thirdId],
        guestEmails: [],
      }),
    ).rejects.toThrow(/Only the organizer/);
  });

  it("tells them in-app that they have been invited", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    const { userId: memberId } = await addWorkspaceMember(
      t,
      workspaceId,
      "member@example.com",
    );

    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [memberId],
      guestEmails: [],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const invitation = deliveredPushes.find((p) =>
      p.recipientIds.includes(String(memberId)),
    );
    expect(invitation?.title).toBe("Calendar invitation");
    expect(invitation?.body).toContain("Standup");
  });
});

describe("joining a series already underway", () => {
  it("invites the new arrival to the standup, not to one instance of it", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    // Running since June — three months of Tuesdays before anyone thought to
    // add this person.
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      anchorDate: "2026-06-02",
    });

    const { userId: memberId, asUser: member } = await addWorkspaceMember(
      t,
      workspaceId,
      "latecomer@example.com",
    );
    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [memberId],
      guestEmails: [],
    });

    const september = await member.query(api.eventSeries.listMineInRange, {
      workspaceId,
      ...SEPTEMBER,
    });
    expect(september).toHaveLength(5);

    // And it keeps going — the invitation is to the rule, so it does not run
    // out at the end of the month they were added in.
    const december = await member.query(api.eventSeries.listMineInRange, {
      workspaceId,
      rangeStartMs: Date.parse("2026-12-01T00:00:00Z"),
      rangeEndMs: Date.parse("2027-01-01T00:00:00Z"),
    });
    expect(december).toHaveLength(5);
  });
});

describe("removing someone from a series", () => {
  it("takes them off all of it in one action", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    const { userId: memberId, asUser: member } = await addWorkspaceMember(
      t,
      workspaceId,
      "member@example.com",
    );
    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [memberId],
      guestEmails: [],
    });

    const [row] = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });
    await organizer.mutation(api.eventSeries.removeInvitee, {
      inviteeId: row!._id,
    });

    expect(
      await organizer.query(api.eventSeries.listInvitees, { seriesId }),
    ).toEqual([]);
    expect(
      await member.query(api.eventSeries.listMineInRange, {
        workspaceId,
        ...SEPTEMBER,
      }),
    ).toEqual([]);
  });

  it("takes a guest's link away with them", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...THREE_TUESDAYS,
    });
    const shareId = await inviteGuest(t, organizer, seriesId, "guest@example.com");

    const [row] = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });
    await organizer.mutation(api.eventSeries.removeInvitee, {
      inviteeId: row!._id,
    });

    expect(
      (await t.query(api.eventSeries.getByShareId, { shareId })).status,
    ).toBe("revoked");
    await expect(
      t.mutation(api.eventSeries.respondAsGuest, {
        shareId,
        status: "accepted",
        guestName: "Dana",
      }),
    ).rejects.toThrow(/revoked/);
  });

  it("refuses a colleague who did not organize it", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    const { userId: memberId } = await addWorkspaceMember(
      t,
      workspaceId,
      "member@example.com",
    );
    const { asUser: colleague } = await addWorkspaceMember(
      t,
      workspaceId,
      "colleague@example.com",
    );
    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [memberId],
      guestEmails: [],
    });
    const [row] = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });

    await expect(
      colleague.mutation(api.eventSeries.removeInvitee, {
        inviteeId: row!._id,
      }),
    ).rejects.toThrow(/Only the organizer/);
  });
});

/** Three Tuesdays: 1, 8 and 15 September 2026, the last ending 09:30 Rome. */
const THREE_TUESDAYS = {
  ...WEEKLY_STANDUP,
  rule: { ...WEEKLY_STANDUP.rule, end: { kind: "afterCount" as const, count: 3 } },
};
const LAST_OCCURRENCE_ENDS = Date.parse("2026-09-15T07:30:00Z");

describe("inviting an external guest to a series", () => {
  it("gives them one link for the whole series", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...THREE_TUESDAYS,
    });

    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [],
      guestEmails: ["guest@example.com"],
    });

    const roster = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });
    expect(roster).toHaveLength(1);
    expect(roster[0]?.guestEmail).toBe("guest@example.com");
    expect(roster[0]?.shareId).toBeTruthy();
    expect(roster[0]?.originalStartMs).toBeUndefined();

    // One link, not one per Tuesday.
    const shares = await t.run((ctx) =>
      ctx.db
        .query("resourceShares")
        .withIndex("by_resource_id", (q) => q.eq("resourceId", seriesId))
        .collect(),
    );
    expect(shares).toHaveLength(1);
    expect(shares[0]?.shareId).toBe(roster[0]?.shareId);
  });

  it("shows them the repeating pattern and their own answer, and nobody else's", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...THREE_TUESDAYS,
    });
    const { userId: memberId } = await addWorkspaceMember(
      t,
      workspaceId,
      "colleague@example.com",
    );
    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [memberId],
      guestEmails: ["guest@example.com"],
    });
    const shareId = (
      await organizer.query(api.eventSeries.listInvitees, { seriesId })
    ).find((r) => r.guestEmail)!.shareId!;

    // No identity: this is the public guest landing read.
    const landing = await t.query(api.eventSeries.getByShareId, { shareId });

    expect(landing.status).toBe("active");
    expect(landing.series?.title).toBe("Standup");
    expect(landing.series?.rule.freq).toBe("weekly");
    expect(landing.series?.anchorTime).toBe("09:00");
    expect(landing.invitee?.status).toBe("pending");
    // The guest learns what the meeting is, never who else is on the roster.
    expect(Object.keys(landing)).not.toContain("invitees");
  });

  it("says not-found for a link that is not a series link", async () => {
    const t = createTestContext();
    expect(
      await t.query(api.eventSeries.getByShareId, { shareId: "nope" }),
    ).toEqual({ status: "not_found" });
  });

  it("lets them answer once for the whole series", async () => {
    const t = createTestContext();
    const {
      workspaceId,
      userId: organizerId,
      asUser: organizer,
    } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...THREE_TUESDAYS,
    });
    const shareId = await inviteGuest(t, organizer, seriesId, "guest@example.com");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    resetDeliveredPushes();

    await t.mutation(api.eventSeries.respondAsGuest, {
      shareId,
      status: "accepted",
      guestName: "Dana",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const roster = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });
    expect(roster).toHaveLength(1);
    expect(roster[0]?.status).toBe("accepted");
    expect(roster[0]?.guestName).toBe("Dana");
    expect(roster[0]?.originalStartMs).toBeUndefined();

    const rsvp = deliveredPushes.find((p) =>
      p.recipientIds.includes(String(organizerId)),
    );
    expect(rsvp?.title).toBe("Event RSVP");
    expect(rsvp?.body).toContain("Dana");
  });
});

describe("the occurrence coordinate on a roster row", () => {
  it("is left unset by every path that writes one, meaning `the series`", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...THREE_TUESDAYS,
    });
    const { userId: memberId, asUser: member } = await addWorkspaceMember(
      t,
      workspaceId,
      "member@example.com",
    );

    // Every write path this release has: invite a member, invite a guest,
    // answer as each.
    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [memberId],
      guestEmails: ["guest@example.com"],
    });
    await member.mutation(api.eventSeries.respond, {
      seriesId,
      status: "accepted",
    });
    const shareId = (
      await organizer.query(api.eventSeries.listInvitees, { seriesId })
    ).find((r) => r.guestEmail)!.shareId!;
    await t.mutation(api.eventSeries.respondAsGuest, {
      shareId,
      status: "tentative",
      guestName: "Dana",
    });

    const roster = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });
    expect(roster).toHaveLength(2);
    expect(roster.map((r) => r.originalStartMs)).toEqual([undefined, undefined]);
  });

  it("is nonetheless storable, so narrowing one later needs no migration", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...THREE_TUESDAYS,
    });
    const { userId: memberId } = await addWorkspaceMember(
      t,
      workspaceId,
      "member@example.com",
    );

    // The shape per-occurrence decline will want, written straight in and read
    // back out through the ordinary roster read: the column round-trips today,
    // which is the whole reason it exists before anything sets it.
    const onTheEighth = Date.parse("2026-09-08T07:00:00Z");
    await t.run((ctx) =>
      ctx.db.insert("eventSeriesInvitees", {
        seriesId,
        workspaceId,
        userId: memberId,
        status: "declined",
        originalStartMs: onTheEighth,
      }),
    );

    const roster = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });
    expect(roster.map((r) => r.originalStartMs)).toEqual([onTheEighth]);
  });
});

describe("how long a guest's link lives", () => {
  it("outlives the last occurrence of a series that has an end", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...THREE_TUESDAYS,
    });
    const shareId = await inviteGuest(t, organizer, seriesId, "guest@example.com");

    // An hour after the third and last Tuesday has finished, the link still
    // works — the guest can still find and answer the meeting they attended.
    vi.setSystemTime(LAST_OCCURRENCE_ENDS + 60 * 60 * 1000);
    expect(
      (await t.query(api.eventSeries.getByShareId, { shareId })).status,
    ).toBe("active");

    // Two days later there is nothing left to be invited to.
    vi.setSystemTime(LAST_OCCURRENCE_ENDS + 2 * 24 * 60 * 60 * 1000);
    expect(
      (await t.query(api.eventSeries.getByShareId, { shareId })).status,
    ).toBe("expired");
    await expect(
      t.mutation(api.eventSeries.respondAsGuest, {
        shareId,
        status: "accepted",
        guestName: "Dana",
      }),
    ).rejects.toThrow(/expired/);
  });

  it("outlives the last occurrence even when the series runs past the horizon", async () => {
    const t = createTestContext();
    vi.setSystemTime(Date.parse("2026-09-20T00:00:00Z"));
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    // Five years of Tuesdays: bounded, but far longer than the two-year
    // horizon that bounds a *read*. The guest's link answers to the last
    // occurrence, not to the horizon, or year three locks them out.
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      rule: { ...WEEKLY_STANDUP.rule, end: { kind: "onDate", date: "2031-09-01" } },
    });
    const shareId = await inviteGuest(t, organizer, seriesId, "guest@example.com");

    vi.setSystemTime(Date.parse("2029-09-20T00:00:00Z"));
    expect(
      (await t.query(api.eventSeries.getByShareId, { shareId })).status,
    ).toBe("active");
  });

  it("ages out on an open-ended series the guest never uses", async () => {
    const t = createTestContext();
    vi.setSystemTime(Date.parse("2026-09-20T00:00:00Z"));
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    const shareId = await inviteGuest(t, organizer, seriesId, "guest@example.com");

    // An open-ended series is a statement about the rule, not a licence for a
    // link that never dies. Untouched, it runs out at the horizon.
    vi.setSystemTime(Date.parse("2028-10-01T00:00:00Z"));
    expect(
      (await t.query(api.eventSeries.getByShareId, { shareId })).status,
    ).toBe("expired");
  });

  it("keeps working on an open-ended series the guest keeps using", async () => {
    const t = createTestContext();
    vi.setSystemTime(Date.parse("2026-09-20T00:00:00Z"));
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    const shareId = await inviteGuest(t, organizer, seriesId, "guest@example.com");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Nearly two years on, the guest uses the link.
    vi.setSystemTime(Date.parse("2028-09-01T00:00:00Z"));
    await t.mutation(api.eventSeries.respondAsGuest, {
      shareId,
      status: "accepted",
      guestName: "Dana",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The date that would have ended it had they walked away instead.
    vi.setSystemTime(Date.parse("2028-10-01T00:00:00Z"));
    expect(
      (await t.query(api.eventSeries.getByShareId, { shareId })).status,
    ).toBe("active");

    // And on out to a fresh horizon past the day they last used it.
    vi.setSystemTime(Date.parse("2030-06-01T00:00:00Z"));
    expect(
      (await t.query(api.eventSeries.getByShareId, { shareId })).status,
    ).toBe("active");
  });
});

describe("responding to a series", () => {
  it("records one answer for the whole thing, not one per occurrence", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    const { userId: memberId, asUser: member } = await addWorkspaceMember(
      t,
      workspaceId,
      "member@example.com",
    );
    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [memberId],
      guestEmails: [],
    });

    await member.mutation(api.eventSeries.respond, {
      seriesId,
      status: "accepted",
    });

    // One row, accepted, and filed under the series rather than under any of
    // the five September Tuesdays it covers.
    const roster = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });
    expect(roster).toHaveLength(1);
    expect(roster[0]?.userId).toBe(memberId);
    expect(roster[0]?.status).toBe("accepted");
    expect(roster[0]?.originalStartMs).toBeUndefined();

    // …and the accepted meeting is still all five of them.
    const mine = await member.query(api.eventSeries.listMineInRange, {
      workspaceId,
      ...SEPTEMBER,
    });
    expect(mine).toHaveLength(5);
  });

  it("refuses someone who was never invited", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    const { asUser: bystander } = await addWorkspaceMember(
      t,
      workspaceId,
      "bystander@example.com",
    );

    await expect(
      bystander.mutation(api.eventSeries.respond, {
        seriesId,
        status: "accepted",
      }),
    ).rejects.toThrow(/not invited/);
  });

  it("tells the organizer what the answer was", async () => {
    const t = createTestContext();
    const {
      workspaceId,
      userId: organizerId,
      asUser: organizer,
    } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    const { userId: memberId, asUser: member } = await addWorkspaceMember(
      t,
      workspaceId,
      "member@example.com",
    );
    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [memberId],
      guestEmails: [],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    resetDeliveredPushes();

    await member.mutation(api.eventSeries.respond, {
      seriesId,
      status: "declined",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const rsvp = deliveredPushes.find((p) =>
      p.recipientIds.includes(String(organizerId)),
    );
    expect(rsvp?.title).toBe("Event RSVP");
    expect(rsvp?.body).toContain("declined");
  });
});

describe("an occurrence the organizer moved", () => {
  it("stays on the invitee's calendar, carrying the answer they already gave", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    const { userId: memberId, asUser: member } = await addWorkspaceMember(
      t,
      workspaceId,
      "member@example.com",
    );
    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [memberId],
      guestEmails: [],
    });
    await member.mutation(api.eventSeries.respond, {
      seriesId,
      status: "accepted",
    });

    // Shift the second Tuesday a day later — an **override**, which carries
    // no roster of its own.
    const secondTuesday = Date.parse("2026-09-08T07:00:00Z");
    await organizer.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: secondTuesday,
      startsAt: secondTuesday + 24 * 60 * 60 * 1000,
      endsAt: secondTuesday + 24 * 60 * 60 * 1000 + 30 * 60 * 1000,
    });

    // Still five September occurrences for the invitee: four the rule
    // produces and the moved one, now an event row. Losing the fifth would
    // make the one Tuesday they most needed to know about the one their
    // calendar stopped mentioning.
    const [overrides, fromRule] = await Promise.all([
      member.query(api.calendarEvents.listMineInRange, {
        workspaceId,
        ...SEPTEMBER,
      }),
      member.query(api.eventSeries.listMineInRange, {
        workspaceId,
        ...SEPTEMBER,
      }),
    ]);
    expect(overrides.length + fromRule.length).toBe(5);
    expect(overrides.map((e) => e.startsAt)).toEqual([
      secondTuesday + 24 * 60 * 60 * 1000,
    ]);

    // …and the answer is the series' one answer, so it covers the moved
    // Tuesday exactly as it covers the four that did not move.
    const roster = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });
    expect(roster.map((r) => r.status)).toEqual(["accepted"]);
  });
});
