import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useResourceSuggestions } from "./use-resource-suggestions";
import type { Id } from "@convex/_generated/dataModel";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: mockQuery }) }));

const workspaceId = "ws1" as Id<"workspaces">;

function setup(
  results: { resourceId: string; resourceType: string; name: string }[],
  onDiagramSelect?: (d: { id: Id<"diagrams">; name: string }) => void,
) {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue(results);
  const editor = { insertInlineContent: vi.fn() };
  const { result } = renderHook(() =>
    useResourceSuggestions({ workspaceId, editor, onDiagramSelect }),
  );
  return { getItems: result.current, editor };
}

describe("useResourceSuggestions", () => {
  it("sends the typed query to the server instead of filtering a local list", async () => {
    const { getItems } = setup([
      { resourceId: "doc1", resourceType: "document", name: "Q3 Roadmap" },
    ]);

    const items = await getItems("road");

    expect(mockQuery.mock.calls[0][1]).toMatchObject({ workspaceId, query: "road" });
    expect(items.map((i) => [i.title, i.group])).toEqual([["Q3 Roadmap", "Documents"]]);
  });

  it("inserts a reference chip for a picked document", async () => {
    const { getItems, editor } = setup([
      { resourceId: "doc1", resourceType: "document", name: "Q3 Roadmap" },
    ]);

    (await getItems(""))[0].onItemClick();

    expect(editor.insertInlineContent).toHaveBeenCalledWith([
      {
        type: "resourceReference",
        props: { resourceId: "doc1", resourceType: "document", resourceName: "Q3 Roadmap" },
      },
      " ",
    ]);
  });

  it("routes a picked diagram to the frame picker rather than inserting a chip", async () => {
    // Diagrams are embedded as a PNG snapshot of a chosen frame, so selecting
    // one has to open the picker instead of writing inline content.
    const onDiagramSelect = vi.fn();
    const { getItems, editor } = setup(
      [{ resourceId: "dia1", resourceType: "diagram", name: "Architecture" }],
      onDiagramSelect,
    );

    (await getItems(""))[0].onItemClick();

    expect(onDiagramSelect).toHaveBeenCalledWith({ id: "dia1", name: "Architecture" });
    expect(editor.insertInlineContent).not.toHaveBeenCalled();
  });
});
