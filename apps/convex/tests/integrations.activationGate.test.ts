import { describe, expect, it } from "vitest";
import { canActivateIntegration } from "../convex/integrations/core/activationGate";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

describe("integrations/core/activationGate.canActivateIntegration", () => {
  it("returns false when no isTriage=true status exists on the project", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    // Seed only the "ordinary" statuses — no isTriage.
    await t.run(async (ctx) => {
      await ctx.db.insert("taskStatuses", {
        projectId,
        name: "Todo",
        color: "bg-gray-500",
        order: 0,
        isDefault: true,
        isCompleted: false,
      });
      await ctx.db.insert("taskStatuses", {
        projectId,
        name: "Done",
        color: "bg-green-500",
        order: 1,
        isDefault: false,
        isCompleted: true,
      });
    });

    const result = await t.run((ctx) =>
      canActivateIntegration(ctx, { projectId }),
    );
    expect(result).toBe(false);
  });

  it("returns false when a status exists but isTriage is explicitly false", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId,
        name: "Todo",
        color: "bg-gray-500",
        order: 0,
        isDefault: true,
        isCompleted: false,
        isTriage: false,
      }),
    );

    const result = await t.run((ctx) =>
      canActivateIntegration(ctx, { projectId }),
    );
    expect(result).toBe(false);
  });

  it("returns true when the project has an isTriage=true status", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

    await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId,
        name: "Triage",
        color: "bg-amber-500",
        order: 0,
        isDefault: false,
        isCompleted: false,
        isTriage: true,
      }),
    );

    const result = await t.run((ctx) =>
      canActivateIntegration(ctx, { projectId }),
    );
    expect(result).toBe(true);
  });
});
