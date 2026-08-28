import { describe, expect, it } from "vitest";
import { timelineResourceTypes } from "./timeline-filters";

describe("timelineResourceTypes", () => {
  it("sends no filter when nothing is hidden", () => {
    expect(timelineResourceTypes(undefined)).toBeUndefined();
    expect(timelineResourceTypes(new Set())).toBeUndefined();
  });

  it("sends no filter when only non-timeline types are hidden", () => {
    // The graph hides `tag` by default and tags have no audit resourceType.
    // Filtering on that would have narrowed the feed to the graph types.
    expect(timelineResourceTypes(new Set(["tag"]))).toBeUndefined();
  });

  it("keeps membership, invite, cycle, calendar and share activity when a graph type is hidden", () => {
    const types = timelineResourceTypes(new Set(["tag", "document"]));
    expect(types).toBeDefined();
    expect(types).not.toContain("documents");
    expect(types).toEqual(
      expect.arrayContaining([
        "diagrams",
        "spreadsheets",
        "channels",
        "projects",
        "tasks",
        "workspaces",
        "cycles",
        "channelMembers",
        "workspaceInvites",
        "calendarEvents",
        "shares",
      ]),
    );
  });

  it("still returns the non-graph types when every graph type is hidden", () => {
    const types = timelineResourceTypes(
      new Set(["document", "diagram", "spreadsheet", "channel", "project", "task"]),
    );
    expect(types).toEqual([
      "workspaces",
      "cycles",
      "channelMembers",
      "workspaceInvites",
      "calendarEvents",
      "shares",
    ]);
  });
});
