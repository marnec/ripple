import { describe, it, expect } from "vitest";
import type { ThreadData } from "@blocknote/core/comments";
import {
  filterThreads,
  sortThreads,
  countOpenThreads,
  visibleThreads,
  type ThreadPositions,
} from "./comment-rail-utils";

/** Minimal ThreadData factory — only the fields the rail logic reads. */
function thread(
  id: string,
  overrides: Partial<ThreadData> & {
    commentDates?: number[];
  } = {},
): ThreadData {
  const { commentDates, ...rest } = overrides;
  const createdAt = rest.createdAt ?? new Date(1000);
  const comments = (commentDates ?? [createdAt.getTime()]).map((t, i) => ({
    type: "comment" as const,
    id: `${id}-c${i}`,
    userId: "u1",
    createdAt: new Date(t),
    updatedAt: new Date(t),
    reactions: [],
    metadata: {},
    body: [],
  }));
  return {
    type: "thread",
    id,
    createdAt,
    updatedAt: createdAt,
    comments,
    resolved: false,
    metadata: {},
    ...rest,
  };
}

describe("filterThreads", () => {
  const open = thread("open");
  const resolved = thread("resolved", { resolved: true });
  const deleted = thread("deleted", { deletedAt: new Date(2000) });
  const all = [open, resolved, deleted];

  it("hides deleted threads in every filter", () => {
    expect(filterThreads(all, "all").map((t) => t.id)).toEqual([
      "open",
      "resolved",
    ]);
  });

  it("'open' returns only unresolved threads", () => {
    expect(filterThreads(all, "open").map((t) => t.id)).toEqual(["open"]);
  });

  it("'resolved' returns only resolved threads", () => {
    expect(filterThreads(all, "resolved").map((t) => t.id)).toEqual([
      "resolved",
    ]);
  });
});

describe("sortThreads", () => {
  const a = thread("a", { createdAt: new Date(300), commentDates: [300, 900] });
  const b = thread("b", { createdAt: new Date(100), commentDates: [100, 500] });
  const c = thread("c", { createdAt: new Date(200), commentDates: [200] });
  const threads = [a, b, c];

  it("'position' orders by anchor offset, ties broken by creation date", () => {
    const positions: ThreadPositions = new Map([
      ["a", { from: 5, to: 7 }],
      ["b", { from: 50, to: 52 }],
      // c has no resolvable position → sinks to the bottom
    ]);
    expect(sortThreads(threads, "position", positions).map((t) => t.id)).toEqual(
      ["a", "b", "c"],
    );
  });

  it("'oldest' orders by thread creation date ascending", () => {
    expect(sortThreads(threads, "oldest", new Map()).map((t) => t.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("'recent-activity' orders by latest comment date descending", () => {
    // latest comment: a=900, b=500, c=200
    expect(
      sortThreads(threads, "recent-activity", new Map()).map((t) => t.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const input = [a, b, c];
    sortThreads(input, "oldest", new Map());
    expect(input.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("countOpenThreads", () => {
  it("counts only unresolved, non-deleted threads", () => {
    const threads = [
      thread("o1"),
      thread("o2"),
      thread("r", { resolved: true }),
      thread("d", { deletedAt: new Date(1) }),
    ];
    expect(countOpenThreads(threads)).toBe(2);
  });
});

describe("visibleThreads", () => {
  it("filters then sorts", () => {
    const threads = [
      thread("open-late", { createdAt: new Date(500) }),
      thread("resolved", { resolved: true }),
      thread("open-early", { createdAt: new Date(100) }),
    ];
    expect(
      visibleThreads(threads, "open", "oldest", new Map()).map((t) => t.id),
    ).toEqual(["open-early", "open-late"]);
  });
});
