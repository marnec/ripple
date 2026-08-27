import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConvexReactClient } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import {
  fetchDiagramSnapshotBlob,
  MissingDiagramSnapshotError,
} from "./diagram-snapshot";

const DIAGRAM_ID = "diagram_1" as Id<"diagrams">;

function fakeConvex(snapshotUrl: string | null) {
  const query = vi.fn().mockResolvedValue(snapshotUrl);
  return { client: { query } as unknown as ConvexReactClient, query };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchDiagramSnapshotBlob", () => {
  it("asks for the diagram's snapshot URL", async () => {
    const { client, query } = fakeConvex(null);

    await expect(
      fetchDiagramSnapshotBlob(client, DIAGRAM_ID, null),
    ).rejects.toBeInstanceOf(MissingDiagramSnapshotError);

    expect(query).toHaveBeenCalledWith(expect.anything(), {
      resourceType: "diagram",
      resourceId: DIAGRAM_ID,
    });
  });

  it("throws MissingDiagramSnapshotError without fetching when the diagram was never saved", async () => {
    const { client } = fakeConvex(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      fetchDiagramSnapshotBlob(client, DIAGRAM_ID, "frame-1"),
    ).rejects.toBeInstanceOf(MissingDiagramSnapshotError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a failed snapshot download instead of rasterising garbage", async () => {
    const { client } = fakeConvex("https://example.test/snapshot");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    await expect(
      fetchDiagramSnapshotBlob(client, DIAGRAM_ID, null),
    ).rejects.toThrow("403");
  });
});
