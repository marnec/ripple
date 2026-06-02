import { expect, describe, it } from "vitest";
import { api } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

describe("diagram presentation flag", () => {
  it("creates the diagram's node with presentation: false", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const diagramId = await asUser.mutation(api.diagrams.create, { workspaceId, name: "Deck" });

    const node = await t.run(async (ctx) =>
      ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", diagramId))
        .first(),
    );
    expect(node?.presentation).toBe(false);
  });

  it("setPresentation flips the flag and denormalizes onto the node", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const diagramId = await asUser.mutation(api.diagrams.create, { workspaceId, name: "Deck" });

    await asUser.mutation(api.diagrams.setPresentation, { id: diagramId, presentation: true });

    const diagram = await asUser.query(api.diagrams.get, { id: diagramId });
    expect(diagram?.presentation).toBe(true);

    const node = await t.run(async (ctx) =>
      ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", diagramId))
        .first(),
    );
    expect(node?.presentation).toBe(true);

    // …and back off
    await asUser.mutation(api.diagrams.setPresentation, { id: diagramId, presentation: false });
    const reverted = await t.run(async (ctx) =>
      ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", diagramId))
        .first(),
    );
    expect(reverted?.presentation).toBe(false);
  });

  it("listPresentationIds returns only flagged diagrams", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const a = await asUser.mutation(api.diagrams.create, { workspaceId, name: "A" });
    const b = await asUser.mutation(api.diagrams.create, { workspaceId, name: "B" });
    await asUser.mutation(api.diagrams.setPresentation, { id: b, presentation: true });

    const ids = await asUser.query(api.diagrams.listPresentationIds, { workspaceId });
    expect(ids).toEqual([b]);
    expect(ids).not.toContain(a);
  });

  describe("nodes.search excludePresentations", () => {
    async function seed() {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const normal = await asUser.mutation(api.diagrams.create, {
        workspaceId,
        name: "Quarterly chart",
      });
      const deck = await asUser.mutation(api.diagrams.create, {
        workspaceId,
        name: "Quarterly deck",
      });
      await asUser.mutation(api.diagrams.setPresentation, { id: deck, presentation: true });
      return { t, workspaceId, asUser, normal: normal as Id<"diagrams">, deck: deck as Id<"diagrams"> };
    }

    it("includes presentation diagrams by default (Ctrl+K stays complete)", async () => {
      const { workspaceId, asUser, deck } = await seed();
      const results = await asUser.query(api.nodes.search, {
        workspaceId,
        searchText: "Quarterly",
      });
      expect(results.map((r) => r.resourceId)).toContain(deck);
    });

    it("omits presentation diagrams when excludePresentations is set (embed picker)", async () => {
      const { workspaceId, asUser, normal, deck } = await seed();
      const results = await asUser.query(api.nodes.search, {
        workspaceId,
        searchText: "Quarterly",
        excludePresentations: true,
      });
      const ids = results.map((r) => r.resourceId);
      expect(ids).toContain(normal);
      expect(ids).not.toContain(deck);
    });
  });
});
