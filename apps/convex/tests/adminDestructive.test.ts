import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import type { TableNames } from "../convex/_generated/dataModel";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { triggers } from "../convex/dbTriggers";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
  setupWorkspaceWithAdmin, channelFields } from "./helpers";

type T = ReturnType<typeof createTestContext>;

async function makePlatformAdmin(t: T, email = "admin@example.com") {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Platform Admin",
    email,
  });
  await t.run((ctx) => ctx.db.patch(userId, { isPlatformAdmin: true }));
  return { adminId: userId, asAdmin: asUser };
}

async function countBy(
  t: T,
  table: TableNames,
  index: string,
  field: string,
  value: unknown,
) {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .query(table as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .withIndex(index as any, (q: any) => q.eq(field, value))
      .collect();
    return rows.length;
  });
}

describe("admin: workspace hard-delete", () => {
  it("cascades the entire workspace subtree (members, channels+messages, projects+tasks, documents, invites, tags)", async () => {
    const t = createTestContext();
    const { userId: ownerId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: ownerId });

    await t.run(async (ctx) => {
      // extra member
      const memberId = await ctx.db.insert("users", { name: "Member", email: "m@x.com" });
      await ctx.db.insert("workspaceMembers", { userId: memberId, workspaceId, role: WorkspaceRole.MEMBER });
      // channel + message
      const channelId = await ctx.db.insert("channels", { name: "general", workspaceId, ...channelFields("open")});
      await ctx.db.insert("messages", {
        userId: ownerId, isomorphicId: "iso1", body: "hi", plainText: "hi",
        channelId, deleted: false,
      });
      // status + task under the project
      const statusId = await ctx.db.insert("taskStatuses", {
        projectId, name: "To Do", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
      });
      await ctx.db.insert("tasks", {
        projectId, workspaceId, title: "T1", statusId, priority: "medium", completed: false, creatorId: ownerId,
      });
      // document, invite, tag
      await ctx.db.insert("documents", { workspaceId, name: "Doc" });
      await ctx.db.insert("workspaceInvites", { workspaceId, email: "inv@x.com", invitedBy: ownerId, status: "pending" });
      await ctx.db.insert("tags", { workspaceId, name: "urgent" });
    });

    const { asAdmin } = await makePlatformAdmin(t);
    await asAdmin.mutation(api.admin.workspaces.remove, { workspaceId });
    await t.finishInProgressScheduledFunctions();

    expect(await t.run((ctx) => ctx.db.get(workspaceId))).toBeNull();
    expect(await countBy(t, "workspaceMembers", "by_workspace", "workspaceId", workspaceId)).toBe(0);
    expect(await countBy(t, "channels", "by_workspace", "workspaceId", workspaceId)).toBe(0);
    expect(await countBy(t, "projects", "by_workspace", "workspaceId", workspaceId)).toBe(0);
    expect(await countBy(t, "tasks", "by_workspace", "workspaceId", workspaceId)).toBe(0);
    expect(await countBy(t, "taskStatuses", "by_project", "projectId", projectId)).toBe(0);
    expect(await countBy(t, "documents", "by_workspace", "workspaceId", workspaceId)).toBe(0);
    expect(await countBy(t, "workspaceInvites", "by_workspace", "workspaceId", workspaceId)).toBe(0);
    expect(await countBy(t, "tags", "by_workspace", "workspaceId", workspaceId)).toBe(0);
    // recursion reached messages under the channel
    const messages = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(messages).toHaveLength(0);
  });

  it("rejects a caller who is not a platform admin", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await expect(
      asUser.mutation(api.admin.workspaces.remove, { workspaceId }),
    ).rejects.toThrow(/not authorized/i);
  });
});

describe("admin: deactivate / reactivate", () => {
  it("sets disabled + clears live sessions, and reactivate clears the flag", async () => {
    const t = createTestContext();
    const { adminId, asAdmin } = await makePlatformAdmin(t);
    const { userId } = await setupAuthenticatedUser(t, { email: "target@x.com" });
    await t.run((ctx) => ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 1e6 }));

    await asAdmin.mutation(api.admin.users.setDisabled, { userId, value: true });
    expect(await t.run((ctx) => ctx.db.get(userId))).toMatchObject({ disabled: true });
    expect(await countBy(t, "authSessions", "userId", "userId", userId)).toBe(0);

    await asAdmin.mutation(api.admin.users.setDisabled, { userId, value: false });
    expect(await t.run((ctx) => ctx.db.get(userId))).toMatchObject({ disabled: false });

    // self-disable is blocked
    await expect(
      asAdmin.mutation(api.admin.users.setDisabled, { userId: adminId, value: true }),
    ).rejects.toThrow(/your own account/i);
  });
});

describe("admin: delete account", () => {
  it("removes memberships, auth rows, and the user", async () => {
    const t = createTestContext();
    const { asAdmin } = await makePlatformAdmin(t);
    // a workspace owned by someone else; target is just a member
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const { userId } = await setupAuthenticatedUser(t, { email: "victim@x.com" });
    await t.run(async (ctx) => {
      // Insert through the trigger writer so the membersByWorkspace aggregate is
      // seeded — exactly how real mutations add members. removeMembershipCascade
      // deletes through triggers, so a raw insert would leave the aggregate
      // without the key (DELETE_MISSING_KEY).
      await writerWithTriggers(ctx, ctx.db, triggers).insert("workspaceMembers", {
        userId, workspaceId, role: WorkspaceRole.MEMBER,
      });
      const accountId = await ctx.db.insert("authAccounts", { userId, provider: "password", providerAccountId: "victim@x.com" });
      await ctx.db.insert("authVerificationCodes", { accountId, provider: "password", code: "123", expirationTime: Date.now() + 1e6 });
      const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 1e6 });
      await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime: Date.now() + 1e6 });
    });

    await asAdmin.mutation(api.admin.users.deleteAccount, { userId });

    expect(await t.run((ctx) => ctx.db.get(userId))).toBeNull();
    expect(await countBy(t, "workspaceMembers", "by_user", "userId", userId)).toBe(0);
    expect(await countBy(t, "authAccounts", "userIdAndProvider", "userId", userId)).toBe(0);
    expect(await countBy(t, "authSessions", "userId", "userId", userId)).toBe(0);
  });

  it("refuses to delete a user who owns a workspace", async () => {
    const t = createTestContext();
    const { asAdmin } = await makePlatformAdmin(t);
    const { userId: ownerId } = await setupWorkspaceWithAdmin(t); // ownerId owns the workspace
    await expect(
      asAdmin.mutation(api.admin.users.deleteAccount, { userId: ownerId }),
    ).rejects.toThrow(/owns/i);
  });

  it("can't delete yourself", async () => {
    const t = createTestContext();
    const { adminId, asAdmin } = await makePlatformAdmin(t);
    await expect(
      asAdmin.mutation(api.admin.users.deleteAccount, { userId: adminId }),
    ).rejects.toThrow(/your own account/i);
  });
});
