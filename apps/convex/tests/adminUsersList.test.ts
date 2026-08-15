import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

type T = ReturnType<typeof createTestContext>;

async function makePlatformAdmin(t: T, email = "ops@example.com") {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Platform Admin",
    email,
  });
  await t.run((ctx) => ctx.db.patch(userId, { isPlatformAdmin: true }));
  return { adminId: userId, asAdmin: asUser };
}

/**
 * `admin.users.list` is paginated, and its per-row enrichment (auth providers,
 * workspace count) moved from an in-memory join over whole tables to indexed
 * lookups scoped to the page. Those two facts are what these tests pin: the
 * cursor has to actually walk the table, and the enrichment has to stay
 * per-user-correct now that it is no longer built from one global map.
 */
describe("admin/users.list", () => {
  it("enriches each row with its own providers and workspace count", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { workspaceId: secondWorkspaceId } = await setupWorkspaceWithAdmin(t, "Second");
    const { asAdmin } = await makePlatformAdmin(t);

    // A user in two workspaces with two providers, next to one with neither.
    const busyId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { name: "Busy", email: "busy@example.com" });
      for (const ws of [workspaceId, secondWorkspaceId]) {
        await ctx.db.insert("workspaceMembers", {
          userId: id,
          workspaceId: ws,
          role: WorkspaceRole.MEMBER,
        });
      }
      await ctx.db.insert("authAccounts", {
        userId: id,
        provider: "github",
        providerAccountId: "gh-1",
      });
      await ctx.db.insert("authAccounts", {
        userId: id,
        provider: "password",
        providerAccountId: "busy@example.com",
      });
      await ctx.db.insert("users", { name: "Lonely", email: "lonely@example.com" });
      return id;
    });

    const { page } = await asAdmin.query(api.admin.users.list, {
      paginationOpts: { numItems: 50, cursor: null },
    });

    const busy = page.find((u) => u._id === busyId);
    const lonely = page.find((u) => u.name === "Lonely");
    expect(busy?.workspaceCount).toBe(2);
    expect(busy?.providers.slice().sort()).toEqual(["github", "password"]);
    expect(lonely).toMatchObject({ workspaceCount: 0, providers: [] });
    // The workspace owner's own row must not inherit Busy's numbers.
    expect(page.find((u) => u._id === ownerId)?.workspaceCount).toBe(1);
  });

  it("walks the whole table across pages, newest first, without repeats", async () => {
    const t = createTestContext();
    const { asAdmin } = await makePlatformAdmin(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 6; i++) {
        await ctx.db.insert("users", { name: `U${i}`, email: `u${i}@example.com` });
      }
    });

    const first = await asAdmin.query(api.admin.users.list, {
      paginationOpts: { numItems: 4, cursor: null },
    });
    expect(first.page).toHaveLength(4);
    expect(first.isDone).toBe(false);
    // Newest-first: the last user seeded outranks the first.
    expect(first.page.map((u) => u.name)).toContain("U5");
    expect(first.page.map((u) => u.name)).not.toContain("U0");

    const seen = [...first.page.map((u) => u._id)];
    let cursor = first.continueCursor;
    let isDone = first.isDone;
    while (!isDone) {
      const next = await asAdmin.query(api.admin.users.list, {
        paginationOpts: { numItems: 4, cursor },
      });
      seen.push(...next.page.map((u) => u._id));
      cursor = next.continueCursor;
      isDone = next.isDone;
    }

    // 6 seeded + the platform admin.
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("rejects a signed-in user who isn't a platform admin", async () => {
    const t = createTestContext();
    const { asUser } = await setupWorkspaceWithAdmin(t);

    await expect(
      asUser.query(api.admin.users.list, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/Not authorized/);
  });
});

/**
 * The guard that stops a delete from dangling `workspaces.ownerId`. It moved
 * from a full-table scan to the `by_owner` index — same refusal, bounded read.
 */
describe("admin/users.deleteAccount ownership guard", () => {
  it("refuses to delete a workspace owner and names the workspace", async () => {
    const t = createTestContext();
    const { userId: ownerId } = await setupWorkspaceWithAdmin(t, "Acme");
    const { asAdmin } = await makePlatformAdmin(t);

    await expect(
      asAdmin.mutation(api.admin.users.deleteAccount, { userId: ownerId }),
    ).rejects.toThrow(/Acme/);
  });

  it("lets a non-owner through", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { asAdmin } = await makePlatformAdmin(t);

    const memberId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { name: "Member", email: "m@example.com" });
      await ctx.db.insert("workspaceMembers", {
        userId: id,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
      return id;
    });

    await asAdmin.mutation(api.admin.users.deleteAccount, { userId: memberId });
    expect(await t.run((ctx) => ctx.db.get(memberId))).toBeNull();
  });
});
