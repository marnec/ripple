import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { auditLog, logActivity } from "../convex/auditLog";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

type T = ReturnType<typeof createTestContext>;

async function makePlatformAdmin(t: T, email = "operator@example.com") {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Platform Admin",
    email,
  });
  await t.run((ctx) => ctx.db.patch(userId, { isPlatformAdmin: true }));
  return { adminId: userId, asAdmin: asUser };
}

/**
 * The component stamps `Date.now()` itself, and a whole seed runs inside one
 * millisecond — which would leave the ordering assertions resting on index
 * tie-breaking rather than on time. Hand out a strictly increasing clock for
 * the duration of a seed instead.
 */
function withMonotonicClock() {
  let now = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => (now += 1000));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("admin/activity.list", () => {
  it("is gated on platform admin, not on workspace membership", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: asWorkspaceAdmin } = await setupWorkspaceWithAdmin(t);

    // A workspace ADMIN — the strongest role inside the tenant — still can't
    // read the console's copy of the trail.
    await expect(
      asWorkspaceAdmin.query(api.admin.activity.list, { workspaceId }),
    ).rejects.toThrow(/Not authorized/);

    const { asAdmin } = await makePlatformAdmin(t);
    const result = await asAdmin.query(api.admin.activity.list, { workspaceId });
    expect(result.entries).toEqual([]);
    expect(result.workspaceName).toBe("Test Workspace");
  });

  it("returns only this workspace's scope, newest first, with actor identity", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { workspaceId: otherWorkspaceId } = await setupWorkspaceWithAdmin(t, "Other");
    const { asAdmin } = await makePlatformAdmin(t);

    withMonotonicClock();
    await t.run(async (ctx) => {
      await logActivity(ctx, {
        userId,
        resourceType: "documents",
        resourceId: "doc-1",
        action: "created",
        resourceName: "Spec",
        scope: workspaceId,
      });
      await logActivity(ctx, {
        userId,
        resourceType: "tasks",
        resourceId: "task-1",
        action: "status_change",
        resourceName: "Ship it",
        oldValue: "Todo",
        newValue: "Done",
        scope: workspaceId,
      });
      // Same actor, different tenant — must not leak into this page.
      await logActivity(ctx, {
        userId,
        resourceType: "documents",
        resourceId: "doc-2",
        action: "created",
        resourceName: "Elsewhere",
        scope: otherWorkspaceId,
      });
    });

    const { entries, hasMore } = await asAdmin.query(api.admin.activity.list, {
      workspaceId,
    });

    expect(hasMore).toBe(false);
    expect(entries.map((e) => e.action)).toEqual([
      "tasks.status_change",
      "documents.created",
    ]);
    expect(entries.map((e) => e.resourceName)).toEqual(["Ship it", "Spec"]);
    expect(entries[0]).toMatchObject({
      oldValue: "Todo",
      newValue: "Done",
      severity: "info",
      resourceId: "task-1",
      actorId: userId,
      actorName: "Test User",
      actorEmail: "test@example.com",
      actorIsUser: true,
    });
  });

  it("filters by resource type server-side", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asAdmin } = await makePlatformAdmin(t);

    withMonotonicClock();
    await t.run(async (ctx) => {
      for (const [resourceType, resourceId] of [
        ["documents", "doc-1"],
        ["tasks", "task-1"],
        ["channels", "chan-1"],
      ] as const) {
        await logActivity(ctx, {
          userId,
          resourceType,
          resourceId,
          action: "created",
          scope: workspaceId,
        });
      }
    });

    const { entries } = await asAdmin.query(api.admin.activity.list, {
      workspaceId,
      resourceTypes: ["tasks"],
    });
    expect(entries.map((e) => e.resourceId)).toEqual(["task-1"]);
  });

  it("windows with hasMore so the page knows there is a tail", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asAdmin } = await makePlatformAdmin(t);

    withMonotonicClock();
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await logActivity(ctx, {
          userId,
          resourceType: "documents",
          resourceId: `doc-${i}`,
          action: "created",
          scope: workspaceId,
        });
      }
    });

    const first = await asAdmin.query(api.admin.activity.list, { workspaceId, limit: 2 });
    expect(first.entries.map((e) => e.resourceId)).toEqual(["doc-4", "doc-3"]);
    expect(first.hasMore).toBe(true);

    const all = await asAdmin.query(api.admin.activity.list, { workspaceId, limit: 5 });
    expect(all.entries).toHaveLength(5);
    expect(all.hasMore).toBe(false);
  });

  it("labels non-user actors and never links them", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asAdmin } = await makePlatformAdmin(t);

    const goneUserId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { name: "Departed", email: "gone@example.com" });
      await ctx.db.delete(id);
      return id;
    });

    withMonotonicClock();
    await t.run(async (ctx) => {
      await auditLog.log(ctx, {
        action: "documents.deleted",
        actorId: "system:garbage-collector",
        resourceType: "documents",
        resourceId: "doc-1",
        severity: "info",
        scope: workspaceId,
      });
      await logActivity(ctx, {
        userId: goneUserId as Id<"users">,
        resourceType: "documents",
        resourceId: "doc-2",
        action: "created",
        scope: workspaceId,
      });
    });

    const { entries } = await asAdmin.query(api.admin.activity.list, { workspaceId });
    const byResource = new Map(entries.map((e) => [e.resourceId, e]));

    expect(byResource.get("doc-1")).toMatchObject({
      actorName: "Garbage Collector",
      actorIsUser: false,
    });
    expect(byResource.get("doc-1")?.actorId).toBeUndefined();
    expect(byResource.get("doc-2")).toMatchObject({
      actorName: "Deleted user",
      actorIsUser: false,
    });
    expect(byResource.get("doc-2")?.actorId).toBeUndefined();
  });

  it("carries severity and the cascade summary through, and survives the workspace itself", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asAdmin } = await makePlatformAdmin(t);

    withMonotonicClock();
    await t.run(async (ctx) => {
      await auditLog.log(ctx, {
        action: "workspaces.cascade_deleted",
        actorId: userId,
        resourceType: "workspaces",
        resourceId: workspaceId,
        severity: "warning",
        metadata: { messages: 12, tasks: 3 },
        scope: workspaceId,
      });
      // The workspace row is gone; its trail is not.
      await ctx.db.delete(workspaceId);
    });

    const { entries, workspaceName } = await asAdmin.query(api.admin.activity.list, {
      workspaceId,
    });

    expect(workspaceName).toBeNull();
    expect(entries[0].severity).toBe("warning");
    expect(JSON.parse(entries[0].cascadeSummary!)).toEqual({ messages: 12, tasks: 3 });
    // A cascade's metadata is a count map — it must not be read as a name.
    expect(entries[0].resourceName).toBeUndefined();
  });
});

describe("admin/activity.listByUser", () => {
  it("is gated on platform admin", async () => {
    const t = createTestContext();
    const { userId, asUser } = await setupWorkspaceWithAdmin(t);

    await expect(asUser.query(api.admin.activity.listByUser, { userId })).rejects.toThrow(
      /Not authorized/,
    );

    const { asAdmin } = await makePlatformAdmin(t);
    expect(await asAdmin.query(api.admin.activity.listByUser, { userId })).toEqual({
      entries: [],
      hasMore: false,
    });
  });

  it("returns one actor's trail across every workspace, newest first", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { workspaceId: otherWorkspaceId } = await setupWorkspaceWithAdmin(t, "Other");
    const { userId: strangerId } = await setupAuthenticatedUser(t, {
      name: "Stranger",
      email: "stranger@example.com",
    });
    const { asAdmin } = await makePlatformAdmin(t);

    withMonotonicClock();
    await t.run(async (ctx) => {
      await logActivity(ctx, {
        userId,
        resourceType: "documents",
        resourceId: "doc-1",
        action: "created",
        resourceName: "Spec",
        scope: workspaceId,
      });
      // Same person, a different tenant — this is exactly what the workspace
      // page hides and this one must show.
      await logActivity(ctx, {
        userId,
        resourceType: "tasks",
        resourceId: "task-1",
        action: "created",
        resourceName: "Ship it",
        scope: otherWorkspaceId,
      });
      // Someone else in a workspace this user belongs to — must not appear.
      await logActivity(ctx, {
        userId: strangerId,
        resourceType: "documents",
        resourceId: "doc-2",
        action: "created",
        scope: workspaceId,
      });
    });

    const { entries, hasMore } = await asAdmin.query(api.admin.activity.listByUser, {
      userId,
    });

    expect(hasMore).toBe(false);
    expect(entries.map((e) => e.resourceId)).toEqual(["task-1", "doc-1"]);
    expect(entries[0]).toMatchObject({
      action: "tasks.created",
      actorId: userId,
      actorName: "Test User",
      actorIsUser: true,
      workspaceId: otherWorkspaceId,
      workspaceName: "Other",
    });
    expect(entries[1]).toMatchObject({
      workspaceId,
      workspaceName: "Test Workspace",
    });
  });

  it("narrows by workspace and by resource type, both server-side", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { workspaceId: otherWorkspaceId } = await setupWorkspaceWithAdmin(t, "Other");
    const { asAdmin } = await makePlatformAdmin(t);

    withMonotonicClock();
    await t.run(async (ctx) => {
      for (const [scope, resourceType, resourceId] of [
        [workspaceId, "documents", "here-doc"],
        [workspaceId, "tasks", "here-task"],
        [otherWorkspaceId, "documents", "there-doc"],
        [otherWorkspaceId, "tasks", "there-task"],
      ] as const) {
        await logActivity(ctx, {
          userId,
          resourceType,
          resourceId,
          action: "created",
          scope,
        });
      }
    });

    const byWorkspace = await asAdmin.query(api.admin.activity.listByUser, {
      userId,
      workspaceId,
    });
    expect(byWorkspace.entries.map((e) => e.resourceId).sort()).toEqual([
      "here-doc",
      "here-task",
    ]);

    const byType = await asAdmin.query(api.admin.activity.listByUser, {
      userId,
      resourceTypes: ["tasks"],
    });
    expect(byType.entries.map((e) => e.resourceId).sort()).toEqual(["here-task", "there-task"]);

    // Both at once: the type filter is indexed, the scope rides along as a
    // stream filter — the pair must still intersect, not union.
    const both = await asAdmin.query(api.admin.activity.listByUser, {
      userId,
      workspaceId,
      resourceTypes: ["tasks"],
    });
    expect(both.entries.map((e) => e.resourceId)).toEqual(["here-task"]);
  });

  it("still fills the window under a filter — the tail signal stays truthful", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asAdmin } = await makePlatformAdmin(t);

    withMonotonicClock();
    await t.run(async (ctx) => {
      // Interleaved, so a filter applied *after* truncating to `limit` would
      // return one row instead of two.
      for (let i = 0; i < 4; i++) {
        await logActivity(ctx, {
          userId,
          resourceType: i % 2 === 0 ? "documents" : "tasks",
          resourceId: `res-${i}`,
          action: "created",
          scope: workspaceId,
        });
      }
    });

    const page = await asAdmin.query(api.admin.activity.listByUser, {
      userId,
      resourceTypes: ["documents"],
      limit: 2,
    });
    expect(page.entries.map((e) => e.resourceId)).toEqual(["res-2", "res-0"]);
    expect(page.hasMore).toBe(false);
  });

  it("windows with hasMore so the section knows there is a tail", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asAdmin } = await makePlatformAdmin(t);

    withMonotonicClock();
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await logActivity(ctx, {
          userId,
          resourceType: "documents",
          resourceId: `doc-${i}`,
          action: "created",
          scope: workspaceId,
        });
      }
    });

    const first = await asAdmin.query(api.admin.activity.listByUser, { userId, limit: 2 });
    expect(first.entries.map((e) => e.resourceId)).toEqual(["doc-4", "doc-3"]);
    expect(first.hasMore).toBe(true);

    const all = await asAdmin.query(api.admin.activity.listByUser, { userId, limit: 5 });
    expect(all.entries).toHaveLength(5);
    expect(all.hasMore).toBe(false);
  });

  it("survives a deleted workspace and an unscoped entry", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asAdmin } = await makePlatformAdmin(t);

    withMonotonicClock();
    await t.run(async (ctx) => {
      await logActivity(ctx, {
        userId,
        resourceType: "documents",
        resourceId: "doc-1",
        action: "created",
        scope: workspaceId,
      });
      // No scope at all — platform-level events exist and must not drop out.
      await logActivity(ctx, {
        userId,
        resourceType: "workspaces",
        resourceId: "ws-x",
        action: "created",
      });
      await ctx.db.delete(workspaceId);
    });

    const { entries } = await asAdmin.query(api.admin.activity.listByUser, { userId });
    const byResource = new Map(entries.map((e) => [e.resourceId, e]));

    // The workspace row is gone; its id is still the scope, so the row keeps
    // the link and loses only the name.
    expect(byResource.get("doc-1")).toMatchObject({ workspaceId });
    expect(byResource.get("doc-1")?.workspaceName).toBeUndefined();
    expect(byResource.get("ws-x")?.workspaceId).toBeUndefined();
  });
});
