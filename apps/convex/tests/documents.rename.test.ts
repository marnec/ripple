import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";
import { WorkspaceRole } from "@ripple/shared/enums/roles";

/**
 * `documents.rename` guards against a duplicate name. It used to ask that
 * question through the `by_name` SEARCH index, which is tokenized — it ORs over
 * terms and matches prefixes — so the guard fired on documents that merely
 * shared a word, and on the document being renamed. These pin what the guard
 * actually means: an exact name collision with a *different* document in the
 * same workspace.
 */

type TestContext = ReturnType<typeof createTestContext>;

async function makeDocument(
  t: TestContext,
  workspaceId: Id<"workspaces">,
  name: string,
) {
  return await t.run((ctx) => ctx.db.insert("documents", { workspaceId, name }));
}

describe("documents.rename — duplicate-name guard", () => {
  it("renames a document that shares words with its own old name", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const id = await makeDocument(t, workspaceId, "Plan A");

    // The tokenized search index matched "Plan A" against itself here.
    await asUser.mutation(api.documents.rename, { id, name: "Plan B" });

    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      name: "Plan B",
    });
  });

  it("allows a name that merely shares a word with another document", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await makeDocument(t, workspaceId, "Q3 Roadmap");
    const id = await makeDocument(t, workspaceId, "Scratch");

    await asUser.mutation(api.documents.rename, { id, name: "Q3 Retro" });

    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      name: "Q3 Retro",
    });
  });

  it("allows renaming a document to the name it already has", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const id = await makeDocument(t, workspaceId, "Notes");

    await asUser.mutation(api.documents.rename, { id, name: "Notes" });

    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      name: "Notes",
    });
  });

  it("still rejects an exact collision with another document", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await makeDocument(t, workspaceId, "Taken");
    const id = await makeDocument(t, workspaceId, "Scratch");

    await expect(
      asUser.mutation(api.documents.rename, { id, name: "Taken" }),
    ).rejects.toThrow(/already exists/i);
  });

  it("scopes the collision to the workspace", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: otherUser } = await setupAuthenticatedUser(t, {
      email: "other@test.com",
    });
    const otherWorkspace = await t.run(async (ctx) => {
      const ws = await ctx.db.insert("workspaces", {
        name: "Other",
        ownerId: otherUser,
      });
      await ctx.db.insert("workspaceMembers", {
        userId: otherUser,
        workspaceId: ws,
        role: WorkspaceRole.ADMIN,
      });
      return ws;
    });
    await makeDocument(t, otherWorkspace, "Shared Title");
    const id = await makeDocument(t, workspaceId, "Scratch");

    await asUser.mutation(api.documents.rename, { id, name: "Shared Title" });

    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      name: "Shared Title",
    });
  });

  it("survives two documents that already share a name", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    // `documents.create` enforces nothing, so this state is reachable today.
    await makeDocument(t, workspaceId, "Duplicate");
    await makeDocument(t, workspaceId, "Duplicate");
    const id = await makeDocument(t, workspaceId, "Scratch");

    // The guard must report the collision, not blow up on the pre-existing
    // pair — which is why the lookup is `.take(2)` and not `.unique()`.
    await expect(
      asUser.mutation(api.documents.rename, { id, name: "Duplicate" }),
    ).rejects.toThrow(/already exists/i);
  });
});
