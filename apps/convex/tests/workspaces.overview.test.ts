import { describe, expect, it } from "vitest";
import { ChannelType } from "@ripple/shared/enums/roles";
import { api } from "../convex/_generated/api";
import {
  membersByWorkspace,
  tagsByWorkspace,
} from "../convex/dbTriggers";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

/**
 * `workspaces.overview` serves the workspace landing page's counter cards from
 * the nine per-workspace aggregates. It exists so the cards do NOT have to
 * count `graph.getWorkspaceGraph`'s nodes — deriving them from the graph payload
 * is what made that unbounded five-table subscription mandatory on the page.
 *
 * The invariant under test: every count equals the real row count for the
 * workspace, and stays equal across creates and deletes.
 */

/**
 * Enrol rows that were seeded with a raw `ctx.db.insert` (the shared fixtures
 * bypass triggers, so they are never counted). This mirrors exactly what
 * `migrations.backfillMemberAggregates` does in a real deployment.
 */
async function backfillFixtureMembers(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Id<"workspaces">,
) {
  await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    for (const row of rows) {
      await membersByWorkspace.insertIfDoesNotExist(ctx, row);
    }
  });
}

describe("workspaces.overview", () => {
  it("counts resources created through the API", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    await backfillFixtureMembers(t, workspaceId);

    await asUser.mutation(api.documents.create, { workspaceId, name: "Doc A" });
    await asUser.mutation(api.documents.create, { workspaceId, name: "Doc B" });
    await asUser.mutation(api.diagrams.create, { workspaceId, name: "Diag" });
    await asUser.mutation(api.spreadsheets.create, { workspaceId, name: "Sheet" });
    await asUser.mutation(api.channels.create, {
      workspaceId,
      name: "general",
      type: ChannelType.OPEN,
    });
    const projectId = await asUser.mutation(api.projects.create, {
      workspaceId,
      name: "Proj",
      color: "bg-blue-500",
    });
    await asUser.mutation(api.tasks.create, {
      workspaceId,
      projectId,
      title: "Task one",
    });
    await asUser.mutation(api.tasks.create, {
      workspaceId,
      projectId,
      title: "Task two",
    });

    const overview = await asUser.query(api.workspaces.overview, { workspaceId });

    expect(overview).toEqual({
      members: 1,
      channels: 1,
      tasks: 2,
      projects: 1,
      documents: 2,
      diagrams: 1,
      spreadsheets: 1,
      calendarEvents: 0,
      tags: 0,
    });

    // The counts must agree with the tables themselves, not merely be stable.
    const actual = await t.run(async (ctx) => {
      const count = async (table: "documents" | "channels" | "tasks" | "projects") =>
        (
          await ctx.db
            .query(table)
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
            .collect()
        ).length;
      return {
        documents: await count("documents"),
        channels: await count("channels"),
        tasks: await count("tasks"),
        projects: await count("projects"),
      };
    });

    expect(overview).not.toBeNull();
    expect(overview!.documents).toBe(actual.documents);
    expect(overview!.channels).toBe(actual.channels);
    expect(overview!.tasks).toBe(actual.tasks);
    expect(overview!.projects).toBe(actual.projects);
    expect(userId).toBeTruthy();
  });

  it("decrements when a resource is deleted", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await backfillFixtureMembers(t, workspaceId);

    const docId = await asUser.mutation(api.documents.create, {
      workspaceId,
      name: "Temp",
    });

    const before = await asUser.query(api.workspaces.overview, { workspaceId });
    expect(before?.documents).toBe(1);

    await asUser.mutation(api.documents.remove, { id: docId });

    const after = await asUser.query(api.workspaces.overview, { workspaceId });
    expect(after?.documents).toBe(0);
  });

  it("counts tags created through the tag sync path", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await backfillFixtureMembers(t, workspaceId);

    const projectId = await asUser.mutation(api.projects.create, {
      workspaceId,
      name: "Tagged",
      color: "bg-blue-500",
    });
    await asUser.mutation(api.tasks.create, {
      workspaceId,
      projectId,
      title: "Has tags",
      labels: ["alpha", "beta"],
    });

    const overview = await asUser.query(api.workspaces.overview, { workspaceId });
    expect(overview?.tags).toBe(2);

    const actualTags = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("tags")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
            .collect()
        ).length,
    );
    expect(overview?.tags).toBe(actualTags);
  });

  it("isolates counts per workspace", async () => {
    const t = createTestContext();
    const { workspaceId: wsA, asUser } = await setupWorkspaceWithAdmin(t, "A");
    await backfillFixtureMembers(t, wsA);

    const wsB = await asUser.mutation(api.workspaces.create, { name: "B" });

    await asUser.mutation(api.documents.create, { workspaceId: wsA, name: "only-A" });

    const a = await asUser.query(api.workspaces.overview, { workspaceId: wsA });
    const b = await asUser.query(api.workspaces.overview, { workspaceId: wsB });

    expect(a?.documents).toBe(1);
    expect(b?.documents).toBe(0);
    // `workspaces.create` writes its member row through a real mutation, so
    // that one IS enrolled without a backfill.
    expect(b?.members).toBe(1);
  });

  it("returns null for a non-member rather than throwing", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asUser: outsider } = await setupAuthenticatedUser(t, {
      email: "outsider@example.com",
    });

    await expect(
      outsider.query(api.workspaces.overview, { workspaceId }),
    ).resolves.toBeNull();
  });

  it("returns null when unauthenticated", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);

    await expect(
      t.query(api.workspaces.overview, { workspaceId }),
    ).resolves.toBeNull();
  });

  it("does not count rows inserted raw until they are enrolled", async () => {
    // Pins the known property that motivates the backfill migrations: an
    // aggregate only sees a row once a trigger-aware write or an explicit
    // `insertIfDoesNotExist` touches it. Data predating the aggregate reads
    // low until `migrations:runAll` has run.
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const before = await asUser.query(api.workspaces.overview, { workspaceId });
    expect(before?.members).toBe(0);

    await backfillFixtureMembers(t, workspaceId);

    const after = await asUser.query(api.workspaces.overview, { workspaceId });
    expect(after?.members).toBe(1);
  });

  it("is idempotent when the backfill runs twice", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    await backfillFixtureMembers(t, workspaceId);
    await backfillFixtureMembers(t, workspaceId);

    const overview = await asUser.query(api.workspaces.overview, { workspaceId });
    expect(overview?.members).toBe(1);
    expect(tagsByWorkspace).toBeTruthy();
  });
});
