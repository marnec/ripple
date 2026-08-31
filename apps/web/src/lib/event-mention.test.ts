import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";

import { eventMentionHref, eventMentionTarget } from "./event-mention";

const workspaceId = "ws1" as Id<"workspaces">;

describe("what an @event mention points at", () => {
  it("is the event row when the chip carries an event id", () => {
    expect(eventMentionTarget({ eventId: "event1" })).toEqual({
      kind: "event",
      eventId: "event1",
    });
  });

  it("is the series when the chip carries a series id", () => {
    // Mentioning the standup means the ritual, not one Tuesday of it.
    expect(eventMentionTarget({ seriesId: "series1" })).toEqual({
      kind: "series",
      seriesId: "series1",
    });
  });

  it("is nothing at all when the chip carries neither", () => {
    expect(eventMentionTarget({ eventId: "", seriesId: undefined })).toEqual({
      kind: "unknown",
    });
  });
});

describe("where an @event mention links", () => {
  it("opens the event's own page", () => {
    expect(
      eventMentionHref(workspaceId, {
        kind: "event",
        eventId: "event1" as Id<"calendarEvents">,
      }),
    ).toBe("/workspaces/ws1/events/event1");
  });

  it("links to a series bare, carrying no occurrence coordinate", () => {
    // Bare on purpose: a mention is about the pattern, and the bare link
    // resolves to the next occurrence from whenever it is followed.
    expect(
      eventMentionHref(workspaceId, {
        kind: "series",
        seriesId: "series1" as Id<"eventSeries">,
      }),
    ).toBe("/workspaces/ws1/events/series1");
  });
});
