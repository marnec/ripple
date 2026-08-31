/**
 * The series as a first-class resource.
 *
 * A one-off event is a node in the workspace graph, a set of tag rows, an
 * `@`-mention target and — when it names a channel — a `hosted_in` edge. A
 * repeating meeting is one resource too (ADR 0002), so it is all of those
 * things exactly once, however many Tuesdays the rule produces.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { ChannelVisibility } from "@ripple/shared/enums";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

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

describe("a series in the workspace graph", () => {
  it("appears exactly once, under its own title", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const graph = await asUser.query(api.graph.getWorkspaceGraph, { workspaceId });
    expect(
      graph.nodes
        .filter((n) => n.type === "eventSeries")
        .map((n) => `${n.id}:${n.name}`),
    ).toEqual([`${seriesId}:Standup`]);
  });

  it("is still the only node when one of its Tuesdays has been moved", async () => {
    // Giving the *series* a node must not quietly readmit its overrides:
    // an override is a row in the events table written through the same
    // triggers, and every one of them would arrive under the series' own name.
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    const overrideId = await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: Date.parse("2026-09-08T07:00:00Z"),
      startsAt: Date.parse("2026-09-09T07:00:00Z"),
      endsAt: Date.parse("2026-09-09T07:30:00Z"),
    });

    const graph = await asUser.query(api.graph.getWorkspaceGraph, { workspaceId });
    const meetingNodes = graph.nodes
      .filter((n) => n.type === "eventSeries" || n.type === "calendarEvent")
      .map((n) => n.id);
    expect(meetingNodes).toEqual([seriesId]);
    expect(meetingNodes).not.toContain(overrideId);
  });

  it("stays out of global search, exactly as an event does", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const hits = await asUser.query(api.nodes.search, {
      workspaceId,
      searchText: "Standup",
    });
    expect(hits).toEqual([]);
  });

  it("gets the same venue edge to its hosting channel that an event gets", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    // Through the public mutation: the graph only draws a link when both
    // endpoints have nodes, and a raw insert fires no triggers.
    const channelId = await asUser.mutation(api.channels.create, {
      workspaceId,
      name: "standup",
      visibility: ChannelVisibility.PUBLIC,
    });

    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      channelId,
    });

    const graph = await asUser.query(api.graph.getWorkspaceGraph, { workspaceId });
    expect(
      graph.links
        .filter((l) => l.edgeType === "hosted_in")
        .map((l) => `${l.source}->${l.target}`),
    ).toEqual([`${seriesId}->${channelId}`]);
  });

  it("carries its new name into the graph when it is renamed", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await asUser.mutation(api.eventSeries.rename, {
      seriesId,
      title: "Daily sync",
    });

    const graph = await asUser.query(api.graph.getWorkspaceGraph, { workspaceId });
    expect(
      graph.nodes.filter((n) => n.type === "eventSeries").map((n) => n.name),
    ).toEqual(["Daily sync"]);
  });
});

describe("tagging a series", () => {
  it("tags the series once, however many Tuesdays the rule produces", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await asUser.mutation(api.eventSeries.updateTags, {
      seriesId,
      tags: ["Planning"],
    });

    const graph = await asUser.query(api.graph.getWorkspaceGraph, {
      workspaceId,
      includeTags: true,
    });
    const planning = graph.nodes.find(
      (n) => n.type === "tag" && n.name === "planning",
    );
    expect(planning).toBeDefined();
    expect(
      graph.links
        .filter((l) => l.edgeType === "tagged_with")
        .map((l) => `${l.source}->${l.target}`),
    ).toEqual([`${seriesId}->${planning!.id}`]);

    const series = await asUser.query(api.eventSeries.get, { seriesId });
    expect(series?.tags).toEqual(["planning"]);
  });
});

describe("a bare link to a series", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the next occurrence from now", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T00:00:00Z"));

    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const landing = await asUser.query(api.eventSeries.resolveLink, {
      linkId: seriesId,
    });
    expect(landing).toEqual({
      seriesId,
      originalStartMs: Date.parse("2026-09-15T07:00:00Z"),
    });
  });

  it("opens the last occurrence once the series has ended", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-06-01T00:00:00Z"));

    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      rule: { ...WEEKLY_STANDUP.rule, end: { kind: "afterCount" as const, count: 3 } },
    });

    const landing = await asUser.query(api.eventSeries.resolveLink, {
      linkId: seriesId,
    });
    expect(landing).toEqual({
      seriesId,
      originalStartMs: Date.parse("2026-09-15T07:00:00Z"),
    });
  });

  it("still names the series when every occurrence has been skipped", async () => {
    // The one case with no occurrence to land on. Answering "not a series"
    // here would send the viewer to the events table, which has never heard
    // of this id, and the link would be exactly the dead page the fallback
    // exists to prevent.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));

    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      rule: { ...WEEKLY_STANDUP.rule, end: { kind: "afterCount" as const, count: 2 } },
    });
    for (const start of ["2026-09-01T07:00:00Z", "2026-09-08T07:00:00Z"]) {
      await asUser.mutation(api.eventSeries.cancelOccurrence, {
        seriesId,
        originalStartMs: Date.parse(start),
      });
    }

    expect(
      await asUser.query(api.eventSeries.resolveLink, { linkId: seriesId }),
    ).toEqual({ seriesId, originalStartMs: null });
  });

  it("has nothing to say about an id that is not a series", async () => {
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

    expect(
      await asUser.query(api.eventSeries.resolveLink, { linkId: eventId }),
    ).toBeNull();
  });

  it("tells an outsider nothing", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const { asUser: outsider } = await setupAuthenticatedUser(t, {
      email: "outsider@example.com",
    });
    expect(
      await outsider.query(api.eventSeries.resolveLink, { linkId: seriesId }),
    ).toBeNull();
  });
});

describe("@-mentioning a series", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers the series once, whatever the rule produces", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T00:00:00Z"));

    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    // A moved Tuesday. Its row carries the series' own title, and it must not
    // become a second thing anyone can mention.
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: Date.parse("2026-09-08T07:00:00Z"),
      startsAt: Date.parse("2026-09-09T07:00:00Z"),
      endsAt: Date.parse("2026-09-09T07:30:00Z"),
    });

    const searched = await asUser.query(
      api.eventSeries.listForMentionAutocomplete,
      { workspaceId, query: "Standup" },
    );
    expect(searched.map((s) => s.seriesId)).toEqual([seriesId]);

    const browsed = await asUser.query(
      api.eventSeries.listForMentionAutocomplete,
      { workspaceId },
    );
    expect(browsed.map((s) => s.seriesId)).toEqual([seriesId]);
  });

  it("names the next occurrence, so two rituals are told apart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T00:00:00Z"));

    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const [offered] = await asUser.query(
      api.eventSeries.listForMentionAutocomplete,
      { workspaceId },
    );
    expect(offered.title).toBe("Standup");
    expect(offered.nextStartsAt).toBe(Date.parse("2026-09-15T07:00:00Z"));
  });

  it("is refused to someone outside the workspace", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asUser: outsider } = await setupAuthenticatedUser(t, {
      email: "outsider@example.com",
    });

    await expect(
      outsider.query(api.eventSeries.listForMentionAutocomplete, { workspaceId }),
    ).rejects.toThrow();
  });

  it("draws a mention link from the channel to the series itself", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await asUser.mutation(api.channels.create, {
      workspaceId,
      name: "general",
      visibility: ChannelVisibility.PUBLIC,
    });
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await asUser.mutation(api.messages.send, {
      isomorphicId: "m1",
      channelId,
      plainText: "@Standup moves to 09:30",
      body: JSON.stringify([
        {
          type: "paragraph",
          content: [{ type: "eventMention", props: { seriesId } }],
        },
      ]),
    });

    const graph = await asUser.query(api.graph.getWorkspaceGraph, { workspaceId });
    expect(
      graph.links
        .filter((l) => l.edgeType === "mentions")
        .map((l) => `${l.source}->${l.target}`),
    ).toEqual([`${channelId}->${seriesId}`]);
  });
});
