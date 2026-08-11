import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTaskSuggestions } from "./use-task-suggestions";
import type { Id } from "@convex/_generated/dataModel";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: mockQuery }) }));

const workspaceId = "ws1" as Id<"workspaces">;

describe("useTaskSuggestions", () => {
  it("inserts a task mention for the picked task", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([
      {
        _id: "task1",
        title: "Fix login redirect",
        completed: false,
        statusColor: "bg-gray-500",
        projectKey: "TST",
        number: 1,
      },
    ]);
    const editor = { insertInlineContent: vi.fn() };
    const { result } = renderHook(() => useTaskSuggestions({ workspaceId, editor }));

    const items = await result.current("login");

    expect(mockQuery.mock.calls[0][1]).toMatchObject({ workspaceId, query: "login" });
    expect(items.map((i) => [i.title, i.group])).toEqual([["Fix login redirect", "Tasks"]]);

    items[0].onItemClick();
    expect(editor.insertInlineContent).toHaveBeenCalledWith([
      { type: "taskMention", props: { taskId: "task1", taskTitle: "Fix login redirect" } },
      " ",
    ]);
  });
});
