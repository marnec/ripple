import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { WorkspaceRole } from "@shared/enums/roles";

const modules = import.meta.glob("../../convex/**/*.ts");

export function createTestContext() {
  return convexTest(schema, modules);
}

/**
 * Insert a user and return a withIdentity-bound test context.
 * The identity subject uses `userId|session` format matching @convex-dev/auth's getAuthUserId.
 */
export async function setupAuthenticatedUser(
  t: ReturnType<typeof convexTest>,
  userData: { name?: string; email?: string } = {},
) {
  const { name = "Test User", email = "test@example.com" } = userData;

  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name, email });
  });

  const asUser = t.withIdentity({
    subject: `${userId}|test-session`,
    issuer: "test",
    name,
    email,
  });

  return { userId, asUser };
}

/**
 * Create a workspace with an admin user, returning IDs and bound test context.
 */
export async function setupWorkspaceWithAdmin(
  t: ReturnType<typeof convexTest>,
  workspaceName = "Test Workspace",
) {
  const { userId, asUser } = await setupAuthenticatedUser(t);

  const workspaceId = await t.run(async (ctx) => {
    const wsId = await ctx.db.insert("workspaces", {
      name: workspaceName,
      ownerId: userId,
    });
    await ctx.db.insert("workspaceMembers", {
      userId,
      workspaceId: wsId,
      role: WorkspaceRole.ADMIN,
    });
    return wsId;
  });

  return { userId, workspaceId, asUser };
}
