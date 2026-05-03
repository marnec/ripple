import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { WorkspaceRole } from "@shared/enums/roles";
import auditLogComponent from "convex-audit-log/test";
import aggregateComponent from "@convex-dev/aggregate/test";
import cascadingDeleteComponent from "convex-cascading-delete/test";
import rateLimiterComponent from "@convex-dev/rate-limiter/test";
import workpoolComponent from "@convex-dev/workpool/test";

const modules = import.meta.glob("../../convex/**/*.ts");

export function createTestContext() {
  const t = convexTest(schema, modules);
  auditLogComponent.register(t as any);
  cascadingDeleteComponent.register(t as any);
  rateLimiterComponent.register(t);
  workpoolComponent.register(t, "notificationPool");
  // Register workspace resource count aggregates
  aggregateComponent.register(t, "documentsByWorkspace");
  aggregateComponent.register(t, "diagramsByWorkspace");
  aggregateComponent.register(t, "spreadsheetsByWorkspace");
  aggregateComponent.register(t, "projectsByWorkspace");
  aggregateComponent.register(t, "channelsByWorkspace");
  aggregateComponent.register(t, "membersByWorkspace");
  aggregateComponent.register(t, "tasksByWorkspace");
  return t;
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
