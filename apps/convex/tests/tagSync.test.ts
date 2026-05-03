import { expect, describe, it } from "vitest";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { api } from "../convex/_generated/api";
import { triggers } from "../convex/dbTriggers";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import type { Id } from "../convex/_generated/dataModel";

// ── Tag dictionary + entityTags helpers ──────────────────────────────

async function listTags(t: ReturnType<typeof createTestContext>, workspaceId: Id<"workspaces">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("tags")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect(),
  );
}

async function listEntityTags(t: ReturnType<typeof createTestContext>, resourceId: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("entityTags")
      .withIndex("by_resource_id", (q) => q.eq("resourceId", resourceId))
      .collect(),
  );
}

// ── documents.updateTags (the canonical write path) ──────────────────

describe("syncTagsForResource via documents.updateTags", () => {
  it("creates tag dictionary rows and entityTags rows on first add", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const documentId = await asUser.mutation(api.documents.create, { workspaceId });
    await asUser.mutation(api.documents.updateTags, {
      id: documentId,
      tags: ["design", "ops"],
    });

    const tags = await listTags(t, workspaceId);
    expect(tags.map((t) => t.name).sort()).toEqual(["design", "ops"]);

    const joins = await listEntityTags(t, documentId);
    expect(joins.map((j) => j.tagName).sort()).toEqual(["design", "ops"]);
    expect(joins.every((j) => j.resourceType === "document")).toBe(true);

    // Denormalized column also reflects the (normalized) tags.
    const doc = await t.run(async (ctx) => ctx.db.get(documentId));
    expect(doc?.tags?.sort()).toEqual(["design", "ops"]);
  });

  it("normalizes input — trim, lowercase, dedupe", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const documentId = await asUser.mutation(api.documents.create, { workspaceId });
    await asUser.mutation(api.documents.updateTags, {
      id: documentId,
      tags: ["  Design  ", "design", "OPS", "", "ops"],
    });

    const tags = await listTags(t, workspaceId);
    expect(tags.map((t) => t.name).sort()).toEqual(["design", "ops"]);

    const joins = await listEntityTags(t, documentId);
    expect(joins).toHaveLength(2);
  });

  it("removes a tag — deletes join row, keeps dictionary row", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const documentId = await asUser.mutation(api.documents.create, { workspaceId });
    await asUser.mutation(api.documents.updateTags, { id: documentId, tags: ["design", "ops"] });
    await asUser.mutation(api.documents.updateTags, { id: documentId, tags: ["design"] });

    const joins = await listEntityTags(t, documentId);
    expect(joins.map((j) => j.tagName)).toEqual(["design"]);

    const tags = await listTags(t, workspaceId);
    expect(tags.map((t) => t.name).sort()).toEqual(["design", "ops"]); // ops persists
  });

  it("re-applying the same tag list is idempotent — no duplicate join rows", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const documentId = await asUser.mutation(api.documents.create, { workspaceId });
    await asUser.mutation(api.documents.updateTags, { id: documentId, tags: ["design"] });
    await asUser.mutation(api.documents.updateTags, { id: documentId, tags: ["design"] });
    await asUser.mutation(api.documents.updateTags, { id: documentId, tags: ["design"] });

    const joins = await listEntityTags(t, documentId);
    expect(joins).toHaveLength(1);

    const tags = await listTags(t, workspaceId);
    expect(tags).toHaveLength(1);
  });

  it("shares dictionary rows across resources within a workspace", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const docA = await asUser.mutation(api.documents.create, { workspaceId });
    const docB = await asUser.mutation(api.documents.create, { workspaceId });
    await asUser.mutation(api.documents.updateTags, { id: docA, tags: ["design"] });
    await asUser.mutation(api.documents.updateTags, { id: docB, tags: ["design"] });

    const tags = await listTags(t, workspaceId);
    expect(tags).toHaveLength(1);

    // Both resources reference the same dictionary row.
    const joinsA = await listEntityTags(t, docA);
    const joinsB = await listEntityTags(t, docB);
    expect(joinsA[0].tagId).toBe(joinsB[0].tagId);
  });
});

// ── Workspace scoping ────────────────────────────────────────────────

describe("workspace-scoped tag namespace", () => {
  it("a tag named 'design' in workspace A and B are separate dictionary rows", async () => {
    const t = createTestContext();
    const { workspaceId: wsA, asUser: userA, userId } = await setupWorkspaceWithAdmin(t, "A");

    // Set up a second workspace for the same user
    const wsB = await t.run(async (ctx) => {
      const id = await ctx.db.insert("workspaces", { name: "B", ownerId: userId });
      await ctx.db.insert("workspaceMembers", { userId, workspaceId: id, role: WorkspaceRole.ADMIN });
      return id;
    });

    const docA = await userA.mutation(api.documents.create, { workspaceId: wsA });
    const docB = await userA.mutation(api.documents.create, { workspaceId: wsB });

    await userA.mutation(api.documents.updateTags, { id: docA, tags: ["design"] });
    await userA.mutation(api.documents.updateTags, { id: docB, tags: ["design"] });

    const tagsA = await listTags(t, wsA);
    const tagsB = await listTags(t, wsB);

    expect(tagsA).toHaveLength(1);
    expect(tagsB).toHaveLength(1);
    expect(tagsA[0]._id).not.toBe(tagsB[0]._id);
  });

  it("listWorkspaceTags returns only this workspace's tags", async () => {
    const t = createTestContext();
    const { workspaceId: wsA, asUser: userA, userId } = await setupWorkspaceWithAdmin(t, "A");
    const wsB = await t.run(async (ctx) => {
      const id = await ctx.db.insert("workspaces", { name: "B", ownerId: userId });
      await ctx.db.insert("workspaceMembers", { userId, workspaceId: id, role: WorkspaceRole.ADMIN });
      return id;
    });

    const docA = await userA.mutation(api.documents.create, { workspaceId: wsA });
    const docB = await userA.mutation(api.documents.create, { workspaceId: wsB });
    await userA.mutation(api.documents.updateTags, { id: docA, tags: ["alpha"] });
    await userA.mutation(api.documents.updateTags, { id: docB, tags: ["beta"] });

    const fromA = await userA.query(api.tags.listWorkspaceTags, { workspaceId: wsA });
    const fromB = await userA.query(api.tags.listWorkspaceTags, { workspaceId: wsB });

    expect(fromA).toEqual(["alpha"]);
    expect(fromB).toEqual(["beta"]);
  });
});

// ── Auth ─────────────────────────────────────────────────────────────

describe("auth on the tag write path", () => {
  it("rejects non-members of the workspace", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const documentId = await asUser.mutation(api.documents.create, { workspaceId });

    const { asUser: stranger } = await setupAuthenticatedUser(t, { email: "stranger@x.com" });

    await expect(
      stranger.mutation(api.documents.updateTags, { id: documentId, tags: ["nope"] }),
    ).rejects.toThrow();
  });
});

// ── Cascade ──────────────────────────────────────────────────────────

describe("cascade cleanup on resource delete", () => {
  it("deletes entityTags rows when a tagged document is removed; dictionary row persists", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const docA = await asUser.mutation(api.documents.create, { workspaceId });
    const docB = await asUser.mutation(api.documents.create, { workspaceId });
    await asUser.mutation(api.documents.updateTags, { id: docA, tags: ["design"] });
    await asUser.mutation(api.documents.updateTags, { id: docB, tags: ["design"] });

    await asUser.mutation(api.documents.remove, { id: docA });

    const joinsForA = await listEntityTags(t, docA);
    expect(joinsForA).toHaveLength(0);

    // Dictionary row still there — counts are not tracked.
    const tags = await listTags(t, workspaceId);
    expect(tags.map((t) => t.name)).toEqual(["design"]);

    // docB still has the tag.
    const joinsForB = await listEntityTags(t, docB);
    expect(joinsForB).toHaveLength(1);
  });
});

// ── createTag / deleteTag mutations ──────────────────────────────────

describe("createTag", () => {
  it("creates a dictionary row independent of any resource (curated vocabulary)", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const tagId = await asUser.mutation(api.tagSync.createTag, {
      workspaceId,
      name: "Strategy",
    });

    const tag = await t.run(async (ctx) => ctx.db.get(tagId));
    expect(tag).toMatchObject({ name: "strategy", workspaceId });

    // No entityTags rows exist for this tag yet.
    const joins = await t.run(async (ctx) =>
      ctx.db
        .query("entityTags")
        .withIndex("by_workspace_tag", (q) =>
          q.eq("workspaceId", workspaceId).eq("tagId", tagId),
        )
        .collect(),
    );
    expect(joins).toHaveLength(0);
  });

  it("is idempotent on re-call", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const a = await asUser.mutation(api.tagSync.createTag, { workspaceId, name: "alpha" });
    const b = await asUser.mutation(api.tagSync.createTag, { workspaceId, name: "ALPHA" });
    expect(a).toBe(b);

    const tags = await listTags(t, workspaceId);
    expect(tags).toHaveLength(1);
  });
});

describe("deleteTag", () => {
  it("admin-only — strips the tag from every resource and removes the dictionary row", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const documentId = await asUser.mutation(api.documents.create, { workspaceId });
    await asUser.mutation(api.documents.updateTags, { id: documentId, tags: ["design", "ops"] });

    const tags = await listTags(t, workspaceId);
    const designTag = tags.find((t) => t.name === "design")!;

    await asUser.mutation(api.tagSync.deleteTag, { tagId: designTag._id });

    // Dictionary row gone
    const after = await listTags(t, workspaceId);
    expect(after.map((t) => t.name)).toEqual(["ops"]);

    // Join row gone
    const joins = await listEntityTags(t, documentId);
    expect(joins.map((j) => j.tagName)).toEqual(["ops"]);

    // Denormalized column on the resource also stripped
    const doc = await t.run(async (ctx) => ctx.db.get(documentId));
    expect(doc?.tags).toEqual(["ops"]);
  });

  it("rejects non-admin members", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const documentId = await asUser.mutation(api.documents.create, { workspaceId });
    await asUser.mutation(api.documents.updateTags, { id: documentId, tags: ["design"] });

    // Add a non-admin member
    const { asUser: member } = await setupAuthenticatedUser(t, { email: "m@x.com" });
    await t.run(async (ctx) => {
      const memberUser = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("email"), "m@x.com"))
        .unique();
      await ctx.db.insert("workspaceMembers", {
        userId: memberUser!._id,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
    });

    const tags = await listTags(t, workspaceId);
    await expect(
      member.mutation(api.tagSync.deleteTag, { tagId: tags[0]._id }),
    ).rejects.toThrow();
  });
});

// ── Uniqueness invariants enforced by triggers ───────────────────────
// These exercise the dbTriggers guards directly: a write through
// writerWithTriggers that would create a duplicate must abort the tx.

describe("tags table uniqueness trigger", () => {
  it("rejects a second `tags` row with the same (workspaceId, name)", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);

    await expect(
      t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.insert("tags", { workspaceId, name: "design" });
        await db.insert("tags", { workspaceId, name: "design" });
      }),
    ).rejects.toThrow(/Duplicate tag/);
  });

  it("allows the same name in a different workspace", async () => {
    const t = createTestContext();
    const { workspaceId: wsA, userId } = await setupWorkspaceWithAdmin(t, "A");
    const wsB = await t.run(async (ctx) => {
      const id = await ctx.db.insert("workspaces", { name: "B", ownerId: userId });
      await ctx.db.insert("workspaceMembers", { userId, workspaceId: id, role: WorkspaceRole.ADMIN });
      return id;
    });

    await expect(
      t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.insert("tags", { workspaceId: wsA, name: "design" });
        await db.insert("tags", { workspaceId: wsB, name: "design" });
      }),
    ).resolves.not.toThrow();
  });

  it("rejects an update that collides with a sibling tag's name", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);

    const designId = await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.insert("tags", { workspaceId, name: "ops" });
      return await db.insert("tags", { workspaceId, name: "design" });
    });

    await expect(
      t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.patch(designId, { name: "ops" });
      }),
    ).rejects.toThrow(/Duplicate tag/);
  });
});

describe("entityTags uniqueness trigger", () => {
  it("rejects a second `entityTags` row for the same (resourceId, tagId)", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const documentId = await asUser.mutation(api.documents.create, { workspaceId });
    await asUser.mutation(api.documents.updateTags, { id: documentId, tags: ["design"] });
    const tags = await listTags(t, workspaceId);
    const tagId = tags[0]._id;

    await expect(
      t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.insert("entityTags", {
          workspaceId,
          tagId,
          tagName: "design",
          resourceType: "document",
          resourceId: documentId,
        });
      }),
    ).rejects.toThrow(/Duplicate entityTag/);
  });

  it("allows the same tag attached to two different resources", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const docA = await asUser.mutation(api.documents.create, { workspaceId });
    const docB = await asUser.mutation(api.documents.create, { workspaceId });

    await asUser.mutation(api.documents.updateTags, { id: docA, tags: ["design"] });
    await expect(
      asUser.mutation(api.documents.updateTags, { id: docB, tags: ["design"] }),
    ).resolves.not.toThrow();
  });
});

