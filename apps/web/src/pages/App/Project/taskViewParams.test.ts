import { describe, it, expect } from "vitest";
import { parseTaskViewParams, serializeTaskViewParams, taskViewSearch } from "./taskViewParams";

const parse = (search: string) => parseTaskViewParams(new URLSearchParams(search));

describe("parseTaskViewParams", () => {
  it("defaults to active tasks, no sort, board view", () => {
    expect(parse("")).toEqual({
      filters: { completionFilter: "uncompleted", assigneeIds: [], priorities: [], tags: [] },
      sort: null,
      view: "board",
      group: null,
    });
  });

  it("reads multi-valued axes from repeated keys", () => {
    const { filters } = parse("assignee=a&assignee=b&priority=high&priority=urgent&tag=bug&tag=ui");
    expect(filters.assigneeIds).toEqual(["a", "b"]);
    expect(filters.priorities).toEqual(["high", "urgent"]);
    expect(filters.tags).toEqual(["bug", "ui"]);
  });

  it("drops unknown priorities and sort fields", () => {
    const state = parse("priority=critical&priority=low&sort=title");
    expect(state.filters.priorities).toEqual(["low"]);
    expect(state.sort).toBeNull();
  });

  it("normalizes tags and removes duplicates", () => {
    expect(parse("tag=Bug&tag=bug&tag=%20").filters.tags).toEqual(["bug"]);
  });

  it("ignores unknown grouping", () => {
    expect(parse("group=priority").group).toBeNull();
    expect(parse("group=assignee").group).toBe("assignee");
  });

  it("defaults sort direction to ascending", () => {
    expect(parse("sort=dueDate").sort).toEqual({ field: "dueDate", direction: "asc" });
    expect(parse("sort=dueDate&dir=desc").sort).toEqual({ field: "dueDate", direction: "desc" });
  });

  it("keeps one axis with one value in completed mode", () => {
    const { filters } = parse("show=completed&priority=high&priority=low&tag=bug");
    expect(filters).toEqual({
      completionFilter: "completed",
      assigneeIds: [],
      priorities: ["high"],
      tags: [],
    });
  });

  it("leaves active mode multi-axis", () => {
    const { filters } = parse("assignee=a&priority=high&tag=bug");
    expect(filters.assigneeIds).toEqual(["a"]);
    expect(filters.priorities).toEqual(["high"]);
    expect(filters.tags).toEqual(["bug"]);
  });
});

describe("serializeTaskViewParams", () => {
  it("omits defaults", () => {
    expect(serializeTaskViewParams(parse("")).toString()).toBe("");
  });

  it("round-trips", () => {
    const search = "show=completed&tag=a%2Cb&sort=priority&dir=desc&view=list&group=assignee";
    expect(serializeTaskViewParams(parse(search)).toString()).toBe(search);
  });
});

describe("taskViewSearch", () => {
  it("builds a link suffix from partial filters", () => {
    expect(taskViewSearch({ filters: { assigneeIds: ["u1"] }, view: "list" })).toBe(
      "?assignee=u1&view=list",
    );
  });

  it("is empty for the default view", () => {
    expect(taskViewSearch({})).toBe("");
  });
});
