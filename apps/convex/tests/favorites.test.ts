import { expect, describe, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupWorkspaceWithAdmin,
} from "./helpers";

describe("favorites.toggle", () => {
  it("adds a favorite and returns true", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const docId = await t.run(async (ctx) => {
      return await ctx.db.insert("documents", {
        workspaceId,
        name: "Test Doc",
      });
    });

    const result = await asUser.mutation(api.favorites.toggle, {
      workspaceId,
      resourceType: "document",
      resourceId: docId,
    });
    expect(result).toBe(true);
  });

  it("removes a favorite on second toggle", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const docId = await t.run(async (ctx) => {
      return await ctx.db.insert("documents", { workspaceId, name: "Doc" });
    });

    await asUser.mutation(api.favorites.toggle, {
      workspaceId,
      resourceType: "document",
      resourceId: docId,
    });
    const result = await asUser.mutation(api.favorites.toggle, {
      workspaceId,
      resourceType: "document",
      resourceId: docId,
    });
    expect(result).toBe(false);
  });

  it("rejects unauthenticated users", async () => {
    const t = createTestContext();
    // Create real workspace so arg validation passes, but don't set identity
    const workspaceId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Owner", email: "o@t.com" });
      return await ctx.db.insert("workspaces", { name: "WS", ownerId: userId });
    });
    await expect(
      t.mutation(api.favorites.toggle, {
        workspaceId,
        resourceType: "document",
        resourceId: "anything",
      }),
    ).rejects.toThrow("Not authenticated");
  });
});

describe("favorites.isFavorited", () => {
  it("returns false when not favorited", async () => {
    const t = createTestContext();
    const { asUser } = await setupWorkspaceWithAdmin(t);

    const result = await asUser.query(api.favorites.isFavorited, {
      resourceId: "nonexistent",
    });
    expect(result).toBe(false);
  });

  it("returns true after toggling on", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const docId = await t.run(async (ctx) => {
      return await ctx.db.insert("documents", { workspaceId, name: "Doc" });
    });

    await asUser.mutation(api.favorites.toggle, {
      workspaceId,
      resourceType: "document",
      resourceId: docId,
    });

    const result = await asUser.query(api.favorites.isFavorited, {
      resourceId: docId,
    });
    expect(result).toBe(true);
  });

  it("returns false for unauthenticated users", async () => {
    const t = createTestContext();
    const result = await t.query(api.favorites.isFavorited, {
      resourceId: "anything",
    });
    expect(result).toBe(false);
  });
});
