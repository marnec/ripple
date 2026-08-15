/**
 * Calendar events follow the *workspace* rule. Organizing an event is a
 * narrowing applied on top of that rule, never a substitute for it.
 *
 * The whole organizer surface used to open with a bare `requireUser` plus
 * `assertOrganizer(event, userId, verb)` — a helper that took no membership at
 * all. So offboarding did not revoke anything: the ex-organizer kept rewriting,
 * cancelling and re-inviting on a workspace they had left, and an ex-invitee
 * kept a door into the channel's live call. This is the same defect the repo
 * already fixed for projects, where `requireCreator` was deleted for taking no
 * membership (see the note on `requireCreatorOrWorkspaceAdmin` in
 * `authHelpers.ts`); `assertOrganizer` was the surviving copy of that signature.
 *
 * Every case here offboards through the real path — `workspaceMembers.remove`,
 * cascade and all — rather than deleting the row by hand, because the claim
 * under test is precisely that removal revokes these powers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

vi.mock("../convex/utils/sendPushToUsers", async () => {
  const probe = await import("./pushProbe");
  return probe.pushDeliveryMock();
});

/**
 * `joinEventCall` reaches Cloudflare RealtimeKit, so these spies stand in for
 * the network client. The observable that matters is that they are never
 * touched: no meeting provisioned, and above all no participant token minted.
 */
const rtkCreateMeeting = vi.fn(() => Promise.resolve({ id: "meeting-x" }));
const rtkAddParticipant = vi.fn(() => Promise.resolve({ token: "tok" }));
vi.mock("../convex/lib/realtimeKit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../convex/lib/realtimeKit")>()),
  realtimeKitFromEnv: () => ({
    createMeeting: rtkCreateMeeting,
    addParticipant: rtkAddParticipant,
    deleteMeeting: vi.fn(() => Promise.resolve()),
  }),
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type TestContext = ReturnType<typeof createTestContext>;

const ONE_HOUR = 60 * 60 * 1000;

/**
 * An admin (who stays) and an organizer (who is about to be removed), plus one
 * event the organizer created inside the workspace.
 */
async function setupOffboardedOrganizer(t: TestContext) {
  const admin = await setupWorkspaceWithAdmin(t, "Acme");
  const organizer = await setupAuthenticatedUser(t, {
    name: "Organizer",
    email: "organizer@acme.test",
  });
  await t.run((ctx) =>
    ctx.db.insert("workspaceMembers", {
      userId: organizer.userId,
      workspaceId: admin.workspaceId,
      role: WorkspaceRole.MEMBER,
    }),
  );

  const startsAt = Date.now() + ONE_HOUR;
  const eventId = await organizer.asUser.mutation(api.calendarEvents.create, {
    workspaceId: admin.workspaceId,
    title: "Quarterly planning",
    startsAt,
    endsAt: startsAt + ONE_HOUR,
    timezone: "UTC",
    invitees: { userIds: [], guestEmails: [] },
  });

  /** Offboard through the real mutation, cascade included. */
  const offboard = async () => {
    await admin.asUser.mutation(api.workspaceMembers.remove, {
      workspaceId: admin.workspaceId,
      targetUserId: organizer.userId,
    });
  };

  return { admin, organizer, eventId, startsAt, offboard };
}

describe("calendar events — an offboarded organizer keeps no authority", () => {
  it("refuses to cancel an event in a workspace the organizer has left", async () => {
    const t = createTestContext();
    const { organizer, eventId, offboard } = await setupOffboardedOrganizer(t);
    await offboard();

    await expect(
      organizer.asUser.mutation(api.calendarEvents.cancel, { eventId }),
    ).rejects.toThrow("Not a member of this workspace");

    // `cancel` is a hard delete that cascades over invitees, shares, the graph
    // node and its edges — so the row still being there is the whole assertion.
    expect(await t.run((ctx) => ctx.db.get(eventId))).not.toBeNull();
  });

  it("refuses to rewrite an event in a workspace the organizer has left", async () => {
    const t = createTestContext();
    const { organizer, eventId, startsAt, offboard } = await setupOffboardedOrganizer(t);
    await offboard();

    await expect(
      organizer.asUser.mutation(api.calendarEvents.update, {
        eventId,
        title: "HIJACKED",
        startsAt: startsAt + 24 * ONE_HOUR,
        endsAt: startsAt + 25 * ONE_HOUR,
      }),
    ).rejects.toThrow("Not a member of this workspace");

    // A successful edit does not just change a row: it fires reschedule pushes
    // and ICS reschedule mail at current members and external guests.
    const stored = await t.run((ctx) => ctx.db.get(eventId));
    expect(stored?.title).toBe("Quarterly planning");
    expect(stored?.startsAt).toBe(startsAt);
  });

  it("refuses to add invitees to an event in a workspace the organizer has left", async () => {
    const t = createTestContext();
    const { organizer, eventId, offboard } = await setupOffboardedOrganizer(t);
    await offboard();

    await expect(
      organizer.asUser.mutation(api.calendarEvents.addInvitees, {
        eventId,
        userIds: [],
        guestEmails: ["outsider@elsewhere.test"],
      }),
    ).rejects.toThrow("Not a member of this workspace");

    // A guest invitee is a share link into the workspace, so this is the
    // ex-member minting workspace-scoped credentials for a third party.
    const invitees = await t.run((ctx) => ctx.db.query("calendarEventInvitees").collect());
    expect(invitees).toHaveLength(0);
    const shares = await t.run((ctx) => ctx.db.query("resourceShares").collect());
    expect(shares).toHaveLength(0);
  });

  it("refuses to tag an event in a workspace the organizer has left", async () => {
    const t = createTestContext();
    const { organizer, eventId, offboard } = await setupOffboardedOrganizer(t);
    await offboard();

    await expect(
      organizer.asUser.mutation(api.calendarEvents.updateEventTags, {
        eventId,
        tags: ["injected-tag"],
      }),
    ).rejects.toThrow("Not a member of this workspace");

    // Tags are not event-local: the write reconciles the workspace-wide `tags`
    // table, so a refused call must leave no row behind there either.
    const tags = await t.run((ctx) => ctx.db.query("tags").collect());
    expect(tags).toHaveLength(0);
  });

  it("refuses to remove an invitee from an event in a workspace the organizer has left", async () => {
    const t = createTestContext();
    const { admin, organizer, eventId, offboard } = await setupOffboardedOrganizer(t);
    // Invite the admin while the organizer is still a member, so there is a
    // row to attack after offboarding.
    await organizer.asUser.mutation(api.calendarEvents.addInvitees, {
      eventId,
      userIds: [admin.userId],
      guestEmails: [],
    });
    const inviteeId = (await t.run((ctx) =>
      ctx.db.query("calendarEventInvitees").first(),
    ))!._id as Id<"calendarEventInvitees">;
    await offboard();

    await expect(
      organizer.asUser.mutation(api.calendarEvents.removeInvitee, { inviteeId }),
    ).rejects.toThrow("Not a member of this workspace");

    // This mutation reaches its event through the invitee row rather than an
    // eventId arg, so the gate has to be derived from the loaded event.
    expect(await t.run((ctx) => ctx.db.get(inviteeId))).not.toBeNull();
  });

  it("refuses a self-invite into a workspace the organizer has left", async () => {
    const t = createTestContext();
    const { organizer, eventId, offboard } = await setupOffboardedOrganizer(t);
    await offboard();

    // This one always refused eventually — it had the membership lookup, but
    // ran it last. The gate now comes first, so the error names the rule rather
    // than confirming the event exists and how full its guest list is.
    await expect(
      organizer.asUser.mutation(api.calendarEvents.selfInvite, { eventId }),
    ).rejects.toThrow("Not a member of this workspace");
  });
});

/**
 * The invitee side had the same hole one step removed: an `calendarEventInvitees`
 * row admitted on its own, and nothing deletes those rows on offboarding (by
 * design — see `removeMembershipCascade`), so the row outlives the membership
 * and was the whole credential.
 */
describe("calendar events — an offboarded invitee keeps no authority", () => {
  /** Admin organizes; `guest` is invited, then removed from the workspace. */
  async function setupOffboardedInvitee(t: TestContext) {
    const admin = await setupWorkspaceWithAdmin(t, "Acme");
    const guest = await setupAuthenticatedUser(t, {
      name: "Guest",
      email: "guest@acme.test",
    });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: guest.userId,
        workspaceId: admin.workspaceId,
        role: WorkspaceRole.MEMBER,
      }),
    );

    const startsAt = Date.now() + ONE_HOUR;
    const eventId = await admin.asUser.mutation(api.calendarEvents.create, {
      workspaceId: admin.workspaceId,
      title: "All hands",
      startsAt,
      endsAt: startsAt + ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [guest.userId], guestEmails: [] },
    });

    const offboard = async () => {
      await admin.asUser.mutation(api.workspaceMembers.remove, {
        workspaceId: admin.workspaceId,
        targetUserId: guest.userId,
      });
    };

    return { admin, guest, eventId, startsAt, offboard };
  }

  it("refuses an RSVP from an invitee who has left the workspace", async () => {
    const t = createTestContext();
    const { guest, eventId, offboard } = await setupOffboardedInvitee(t);
    await offboard();

    await expect(
      guest.asUser.mutation(api.calendarEvents.respond, {
        eventId,
        status: "accepted",
      }),
      // The invitee row survives removal, so without a membership lookup it is
      // the ex-member's standing credential on the event.
    ).rejects.toThrow("Not a member of this workspace");
  });

  it("refuses a call token to an invitee who has left the workspace", async () => {
    const t = createTestContext();
    const { admin, guest, offboard } = await setupOffboardedInvitee(t);

    // A channel-tied event, live right now: `joinEventCall` would hand back a
    // token into the CHANNEL's persistent meeting room — the same room
    // `callSessions.joinCall` guards with the channel rule — putting the
    // ex-member in a live call with current employees.
    const channelId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("channels", {
        name: "general",
        workspaceId: admin.workspaceId,
        type: "open" as const,
      });
      return id;
    });
    const now = Date.now();
    const eventId = await admin.asUser.mutation(api.calendarEvents.create, {
      workspaceId: admin.workspaceId,
      title: "Standup",
      startsAt: now,
      endsAt: now + ONE_HOUR,
      timezone: "UTC",
      channelId,
      invitees: { userIds: [guest.userId], guestEmails: [] },
    });
    await offboard();

    await expect(
      guest.asUser.action(api.calendarEvents.joinEventCall, {
        eventId,
        userName: "Guest",
      }),
    ).rejects.toThrow();

    expect(rtkAddParticipant, "no participant token may be minted").not.toHaveBeenCalled();
    expect(rtkCreateMeeting, "authorization must precede provisioning").not.toHaveBeenCalled();
  });
});
