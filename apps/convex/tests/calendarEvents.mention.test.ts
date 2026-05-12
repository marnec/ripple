import { describe, it, expect, beforeEach } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

type TestContext = ReturnType<typeof createTestContext>;

const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

async function addMember(
  t: TestContext,
  workspaceId: string,
  userId: string,
  role: "admin" | "member" = "member",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMembers", {
      workspaceId: workspaceId as any,
      userId: userId as any,
      role,
    });
  });
}

async function createEvent(
  asUser: ReturnType<TestContext["withIdentity"]>,
  workspaceId: string,
  title: string,
  startsAt: number,
  endsAt: number = startsAt + ONE_HOUR,
) {
  return await asUser.mutation(api.calendarEvents.create, {
    workspaceId: workspaceId as any,
    title,
    startsAt,
    endsAt,
    timezone: "UTC",
    invitees: { userIds: [], guestEmails: [] },
  });
}

describe("calendarEvents — mention APIs", () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });

  describe("get — workspace-scoped read", () => {
    it("any workspace member can read any event, even without an invitee row", async () => {
      const { workspaceId, asUser: asOrganizer } = await setupWorkspaceWithAdmin(t);
      const { userId: outsiderId, asUser: asOutsider } = await setupAuthenticatedUser(t, {
        email: "bystander@example.com",
        name: "Bystander",
      });
      await addMember(t, workspaceId, outsiderId);

      const start = Date.now() + ONE_HOUR;
      const eventId = await createEvent(asOrganizer, workspaceId, "Private 1:1", start);

      // No invitee row for outsider, but they're a workspace member — must succeed.
      const detail = await asOutsider.query(api.calendarEvents.get, { eventId });
      expect(detail.event.title).toBe("Private 1:1");
    });

    it("non-members are rejected", async () => {
      const { workspaceId, asUser: asOrganizer } = await setupWorkspaceWithAdmin(t);
      const { asUser: asStranger } = await setupAuthenticatedUser(t, {
        email: "stranger@example.com",
        name: "Stranger",
      });

      const start = Date.now() + ONE_HOUR;
      const eventId = await createEvent(asOrganizer, workspaceId, "Sync", start);

      await expect(
        asStranger.query(api.calendarEvents.get, { eventId }),
      ).rejects.toThrow();
    });
  });

  describe("listForMentionAutocomplete", () => {
    it("empty query: returns upcoming + recent events in the [-7d, +30d] window, split by group", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const now = Date.now();

      const futureSoon = await createEvent(asUser, workspaceId, "Future soon", now + ONE_DAY);
      const futureFar = await createEvent(asUser, workspaceId, "Future far", now + 60 * ONE_DAY);
      const recent = await createEvent(asUser, workspaceId, "Recent past", now - ONE_DAY);
      const ancient = await createEvent(asUser, workspaceId, "Ancient", now - 60 * ONE_DAY);

      const results = await asUser.query(api.calendarEvents.listForMentionAutocomplete, {
        workspaceId: workspaceId as any,
      });

      const ids = results.map((r) => r.eventId);
      expect(ids).toContain(futureSoon);
      expect(ids).toContain(recent);
      // Outside the [-7d, +30d] window:
      expect(ids).not.toContain(futureFar);
      expect(ids).not.toContain(ancient);

      const upcoming = results.filter((r) => r.group === "upcoming");
      const recents = results.filter((r) => r.group === "recent");
      expect(upcoming[0].eventId).toBe(futureSoon);
      expect(recents[0].eventId).toBe(recent);
    });

    it("non-empty query: uses the title FTS index", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const now = Date.now();

      // Far future — outside the empty-query browse window, but reachable
      // via FTS since search mode ignores the range constraint.
      const standup = await createEvent(asUser, workspaceId, "Team Standup", now + 60 * ONE_DAY);
      await createEvent(asUser, workspaceId, "Architecture Review", now + ONE_DAY);

      const results = await asUser.query(api.calendarEvents.listForMentionAutocomplete, {
        workspaceId: workspaceId as any,
        query: "standup",
      });

      const ids = results.map((r) => r.eventId);
      expect(ids).toContain(standup);
      expect(ids.length).toBeLessThanOrEqual(8);
    });

    it("rejects non-members", async () => {
      const { workspaceId } = await setupWorkspaceWithAdmin(t);
      const { asUser: asStranger } = await setupAuthenticatedUser(t, {
        email: "stranger@example.com",
        name: "Stranger",
      });
      await expect(
        asStranger.query(api.calendarEvents.listForMentionAutocomplete, {
          workspaceId: workspaceId as any,
        }),
      ).rejects.toThrow();
    });
  });

  describe("getManyForMentions", () => {
    it("returns metadata for in-workspace events; marks missing rows as deleted", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const now = Date.now();
      const liveId = await createEvent(asUser, workspaceId, "Live event", now + ONE_HOUR);

      // Fabricate a stable-looking but never-inserted id by deleting an event we just created.
      const ghostId = await createEvent(asUser, workspaceId, "About to vanish", now + 2 * ONE_HOUR);
      await asUser.mutation(api.calendarEvents.cancel, { eventId: ghostId });

      const result = await t.query(internal.calendarEvents.getManyForMentions, {
        workspaceId: workspaceId as any,
        eventIds: [liveId, ghostId],
      });

      const byId = new Map(result.map((r) => [r.eventId, r]));
      expect(byId.get(liveId)?.deleted).toBe(false);
      expect(byId.get(liveId)?.title).toBe("Live event");
      expect(byId.get(ghostId)?.deleted).toBe(true);
      expect(byId.get(ghostId)?.title).toBeUndefined();
    });

    it("cross-workspace events are treated as deleted (no metadata leak)", async () => {
      const { workspaceId: wsA, asUser: asUserA } = await setupWorkspaceWithAdmin(t);
      const { workspaceId: wsB, asUser: asUserB } = await setupWorkspaceWithAdmin(t, "Second workspace");

      const eventInB = await createEvent(asUserB, wsB, "Secret B event", Date.now() + ONE_HOUR);

      const result = await t.query(internal.calendarEvents.getManyForMentions, {
        workspaceId: wsA as any,
        eventIds: [eventInB],
      });

      expect(result).toHaveLength(1);
      expect(result[0].deleted).toBe(true);
      expect(result[0].title).toBeUndefined();
      // asUserA reference required to keep helper used in identity binding.
      expect(asUserA).toBeDefined();
    });

    it("dedupes input ids and handles the empty array", async () => {
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const liveId = await createEvent(asUser, workspaceId, "Live", Date.now() + ONE_HOUR);

      const empty = await t.query(internal.calendarEvents.getManyForMentions, {
        workspaceId: workspaceId as any,
        eventIds: [],
      });
      expect(empty).toEqual([]);

      const dup = await t.query(internal.calendarEvents.getManyForMentions, {
        workspaceId: workspaceId as any,
        eventIds: [liveId, liveId, liveId],
      });
      expect(dup).toHaveLength(1);
    });
  });
});
