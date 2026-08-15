import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { triggers } from "../convex/dbTriggers";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

type T = ReturnType<typeof createTestContext>;

async function makePlatformAdmin(t: T, email = "admin@example.com") {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Platform Admin",
    email,
  });
  await t.run((ctx) => ctx.db.patch(userId, { isPlatformAdmin: true }));
  return { adminId: userId, asAdmin: asUser };
}

/**
 * `admin.workspaces.get` serves five of its six counts from the per-workspace
 * aggregates rather than collecting the rows. These assertions pin the numbers
 * that swap has to keep producing — including tenant scoping, which moved from
 * an index range to an aggregate namespace. They cannot detect a return to
 * `.collect().then(r => r.length)`, which is a read-cost regression rather than
 * a behavioural one; the comment on the query is what guards that.
 *
 * Seeds go through `writerWithTriggers` for the same reason the aggregates
 * exist: a raw `ctx.db.insert` fires no trigger, so the aggregate never sees
 * the row and every count would read zero.
 */
describe("admin/workspaces.get counts", () => {
  it("counts each workspace-scoped range and stays scoped to one workspace", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { workspaceId: otherWorkspaceId } = await setupWorkspaceWithAdmin(
      t,
      "Other Workspace",
    );
    const { asAdmin } = await makePlatformAdmin(t);

    await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);

      // 2 channels, 3 documents, 1 diagram, 1 project, 2 tasks.
      await db.insert("channels", { name: "general", workspaceId, type: "open" });
      await db.insert("channels", { name: "random", workspaceId, type: "open" });
      for (const name of ["Doc A", "Doc B", "Doc C"]) {
        await db.insert("documents", { workspaceId, name });
      }
      await db.insert("diagrams", { workspaceId, name: "Arch" });
      const projectId = await db.insert("projects", {
        name: "Core",
        color: "bg-blue-500",
        workspaceId,
        creatorId: ownerId,
      });
      const statusId = await db.insert("taskStatuses", {
        projectId,
        name: "To Do",
        color: "bg-gray-500",
        order: 0,
        isDefault: true,
        isCompleted: false,
      });
      for (const title of ["T1", "T2"]) {
        await db.insert("tasks", {
          projectId,
          workspaceId,
          title,
          statusId,
          priority: "medium",
          completed: false,
          creatorId: ownerId,
        });
      }

      // Neighbouring tenant — must not leak into the counts above.
      await db.insert("channels", {
        name: "theirs",
        workspaceId: otherWorkspaceId,
        type: "open",
      });
      await db.insert("documents", {
        workspaceId: otherWorkspaceId,
        name: "Their Doc",
      });
    });

    const ws = await asAdmin.query(api.admin.workspaces.get, { workspaceId });

    expect(ws).not.toBeNull();
    expect(ws?.counts).toEqual({
      channels: 2,
      documents: 3,
      diagrams: 1,
      projects: 1,
      tasks: 2,
      integrations: 0,
    });
    // The member list is the one range still read for its rows.
    expect(ws?.members).toHaveLength(1);
    expect(ws?.members[0]).toMatchObject({ userId: ownerId, isOwner: true });
  });

  it("reports zeroes for an empty workspace rather than throwing", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asAdmin } = await makePlatformAdmin(t);

    const ws = await asAdmin.query(api.admin.workspaces.get, { workspaceId });

    expect(ws?.counts).toEqual({
      channels: 0,
      documents: 0,
      diagrams: 0,
      projects: 0,
      tasks: 0,
      integrations: 0,
    });
  });

  it("refuses a caller who is not a platform admin", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asUser } = await setupAuthenticatedUser(t, {
      name: "Nosy",
      email: "nosy@example.com",
    });

    await expect(
      asUser.query(api.admin.workspaces.get, { workspaceId }),
    ).rejects.toThrow();
  });
});

/**
 * The list page's counts moved off three deployment-wide `.collect()`s and onto
 * the same per-workspace aggregates, so the cost now scales with the number of
 * workspaces rather than with what is inside them. Tenant attribution is the
 * thing worth pinning: the old shape tallied a map keyed by `workspaceId`, the
 * new one reads a namespace, and a mix-up would show one tenant another's
 * numbers.
 */
describe("admin/workspaces.list counts", () => {
  it("attributes members, channels and projects to the right workspace", async () => {
    const t = createTestContext();
    const { adminId, asAdmin } = await makePlatformAdmin(t);

    // Seeded here rather than via `setupWorkspaceWithAdmin`, which inserts the
    // owner's membership raw: no trigger fires, so the aggregate never counts
    // that row and `memberCount` reads one short. Production writes all go
    // through `functions.ts`'s mutation builder, so this is a fixture concern
    // and not a live one — but it is exactly the drift the aggregates can show.
    const { acmeId, globexId } = await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      const owner = await ctx.db.insert("users", { name: "Owner", email: "o@example.com" });
      const extra = await ctx.db.insert("users", { name: "Extra", email: "x@example.com" });

      // Acme: 2 members, 2 channels, 1 project.
      const acme = await ctx.db.insert("workspaces", { name: "Acme", ownerId: owner });
      for (const userId of [owner, extra]) {
        await db.insert("workspaceMembers", {
          userId,
          workspaceId: acme,
          role: WorkspaceRole.MEMBER,
        });
      }
      await db.insert("channels", { name: "a", workspaceId: acme, type: "open" });
      await db.insert("channels", { name: "b", workspaceId: acme, type: "open" });
      await db.insert("projects", {
        name: "P",
        color: "bg-blue-500",
        workspaceId: acme,
        creatorId: owner,
      });

      // Globex: 1 member, 1 channel, no projects.
      const globex = await ctx.db.insert("workspaces", { name: "Globex", ownerId: adminId });
      await db.insert("workspaceMembers", {
        userId: adminId,
        workspaceId: globex,
        role: WorkspaceRole.ADMIN,
      });
      await db.insert("channels", { name: "theirs", workspaceId: globex, type: "open" });

      return { acmeId: acme, globexId: globex };
    });

    const rows = await asAdmin.query(api.admin.workspaces.list, {});
    const acme = rows.find((w) => w._id === acmeId);
    const globex = rows.find((w) => w._id === globexId);

    expect(acme).toMatchObject({
      memberCount: 2,
      channelCount: 2,
      projectCount: 1,
      ownerName: "Owner",
    });
    expect(globex).toMatchObject({ memberCount: 1, channelCount: 1, projectCount: 0 });
  });

  it("returns workspaces newest-first", async () => {
    const t = createTestContext();
    await setupWorkspaceWithAdmin(t, "First");
    await setupWorkspaceWithAdmin(t, "Second");
    const { asAdmin } = await makePlatformAdmin(t);

    const rows = await asAdmin.query(api.admin.workspaces.list, {});
    expect(rows.map((w) => w.name)).toEqual(["Second", "First"]);
  });
});
