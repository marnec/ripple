import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";
import { useEventSuggestions } from "./use-event-suggestions";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: mockQuery }) }));

const workspaceId = "ws1" as Id<"workspaces">;

/**
 * Answer each of the two autocomplete lanes with its own fixture. Keyed on the
 * function's name rather than on the reference itself — Convex's `api` proxy
 * hands back a fresh object on every property access, so `===` never holds.
 */
function answerWith(events: unknown[], series: unknown[]) {
  mockQuery.mockReset();
  mockQuery.mockImplementation((ref: FunctionReference<"query">) =>
    Promise.resolve(
      getFunctionName(ref).startsWith("eventSeries:") ? series : events,
    ),
  );
}

describe("useEventSuggestions", () => {
  it("offers a series once, and mentioning it targets the series", async () => {
    answerWith(
      [],
      [
        {
          seriesId: "series1",
          title: "Standup",
          nextStartsAt: Date.parse("2026-09-15T07:00:00Z"),
        },
      ],
    );
    const editor = { insertInlineContent: vi.fn() };
    const { result } = renderHook(() => useEventSuggestions({ workspaceId, editor }));

    const items = await result.current("stand");

    expect(items.map((i) => [i.title, i.group])).toEqual([["Standup", "Repeating"]]);

    items[0].onItemClick();
    expect(editor.insertInlineContent).toHaveBeenCalledWith([
      { type: "eventMention", props: { seriesId: "series1" } },
      " ",
    ]);
  });

  it("still offers one-off events, which mention the event row", async () => {
    answerWith(
      [
        {
          eventId: "event1",
          title: "Kickoff",
          startsAt: Date.parse("2026-09-03T09:00:00Z"),
          endsAt: Date.parse("2026-09-03T09:30:00Z"),
          group: "upcoming",
        },
      ],
      [],
    );
    const editor = { insertInlineContent: vi.fn() };
    const { result } = renderHook(() => useEventSuggestions({ workspaceId, editor }));

    const items = await result.current("kick");

    expect(items.map((i) => [i.title, i.group])).toEqual([["Kickoff", "Upcoming"]]);

    items[0].onItemClick();
    expect(editor.insertInlineContent).toHaveBeenCalledWith([
      { type: "eventMention", props: { eventId: "event1" } },
      " ",
    ]);
  });
});
