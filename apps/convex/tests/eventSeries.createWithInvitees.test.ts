/**
 * Inviting people while creating a repeating event.
 *
 * The organizer picks a roster in the create form and presses Create once, so
 * the series and its roster are one fact: `eventSeries.create` takes the
 * roster, and either both land or neither does. These tests read the result
 * through the public roster query rather than the table, so they survive any
 * later change in how the rows are written.
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

beforeEach(() => {
  vi.useFakeTimers();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ data: { id: "resend-1" }, error: null });
  process.env.AUTH_RESEND_KEY = "re_test_key";
  process.env.RESEND_TEST_MODE = "false";
  resetDeliveredPushes();
});
afterEach(() => {
  vi.useRealTimers();
});

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

/** Every address a message actually went out to. */
async function drainMailRecipients(t: T): Promise<string[]> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return sendEmail.mock.calls.map(([payload]) => (payload as { to: string }).to);
}

describe("creating a repeating event with people on it", () => {
  it("puts the members chosen in the form on the series roster", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await addWorkspaceMember(
      t,
      workspaceId,
      "member@example.com",
    );

    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      invitees: { userIds: [memberId], guestEmails: [] },
    });

    const roster = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });
    expect(roster.map((r) => r.userId)).toEqual([memberId]);
    expect(roster[0]!.status).toBe("pending");
  });

  it("sends a guest the one invitation carrying the whole pattern", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);

    await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      invitees: { userIds: [], guestEmails: ["zoe@elsewhere.test"] },
    });

    // One message, not one per Tuesday — the same invitation `addInvitees`
    // sends, because it is literally the same code path.
    expect(await drainMailRecipients(t)).toEqual(["zoe@elsewhere.test"]);
  });

  it("tells the members in the app that they were invited", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await addWorkspaceMember(
      t,
      workspaceId,
      "member@example.com",
    );

    await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      invitees: { userIds: [memberId], guestEmails: [] },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const invitation = deliveredPushes.find((p) =>
      p.recipientIds.includes(String(memberId)),
    );
    expect(invitation?.title).toBe("Calendar invitation");
    expect(invitation?.body).toContain("Standup");
  });

  it("mails nobody when the organizer invited nobody", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);

    // An empty roster arrives as an empty roster, not as an absent one — that
    // is what the form sends when the organizer opened the picker and chose
    // no one, and it must be as silent as never mentioning invitees at all.
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      invitees: { userIds: [], guestEmails: [] },
    });

    expect(
      await organizer.query(api.eventSeries.listInvitees, { seriesId }),
    ).toEqual([]);
    expect(await drainMailRecipients(t)).toEqual([]);
    expect(deliveredPushes).toEqual([]);
  });

  it("leaves no series behind when the roster is refused", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const { userId: outsiderId } = await setupAuthenticatedUser(t, {
      email: "outsider@example.com",
    });

    await expect(
      organizer.mutation(api.eventSeries.create, {
        workspaceId,
        ...WEEKLY_STANDUP,
        invitees: { userIds: [outsiderId], guestEmails: [] },
      }),
    ).rejects.toThrow(/not a member of this workspace/);

    // The reason the roster travels *with* the create rather than after it:
    // one transaction, so a refused invitee cannot leave an orphan standup on
    // the organizer's calendar.
    const series = await t.run((ctx) => ctx.db.query("eventSeries").collect());
    expect(series).toEqual([]);
  });
});
