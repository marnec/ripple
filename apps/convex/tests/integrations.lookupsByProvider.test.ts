import { describe, expect, it } from "vitest";
import { getWorkspaceIntegrationByProvider } from "../convex/integrations/core/integrationLookups";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

/**
 * A workspace can hold a GitHub install and a GitLab install at once. Two
 * callers know which provider they mean before they read — outbound
 * close-failure attribution (`syncOutMutations`, where the task and its link
 * are already gone, so there is no FK left to resolve through) and the GitHub
 * import start. Both previously narrowed `by_workspace` with a `.filter()`;
 * they now read `by_workspace_provider`.
 *
 * The failure this pins is silent, which is why it is worth a test: picking
 * whichever row sorts first attributes a GitLab close-failure to the GitHub
 * install, and the audit-log entry names the wrong bot. Insertion order is
 * varied below so a regression cannot pass by luck.
 */
describe("getWorkspaceIntegrationByProvider", () => {
  async function setupBothProviders(order: readonly string[]) {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const ids = await t.run(async (ctx) => {
      const out: Record<string, string> = {};
      for (const provider of order) {
        const botUserId = await ctx.db.insert("users", {
          name: provider,
          isBot: true,
        });
        out[provider] = await ctx.db.insert("workspaceIntegrations", {
          workspaceId,
          botUserId,
          provider,
          externalAccountId: `install-${provider}`,
        });
      }
      return out;
    });
    return { t, workspaceId, ids };
  }

  for (const order of [
    ["github", "gitlab"],
    ["gitlab", "github"],
  ] as const) {
    it(`returns the row for the asked-for provider (inserted ${order.join(" then ")})`, async () => {
      const { t, workspaceId, ids } = await setupBothProviders(order);

      await t.run(async (ctx) => {
        for (const provider of order) {
          const found = await getWorkspaceIntegrationByProvider(
            ctx,
            workspaceId,
            provider,
          );
          expect(found?._id).toBe(ids[provider]);
          expect(found?.provider).toBe(provider);
        }
      });
    });
  }

  it("returns null for a provider the workspace has not installed", async () => {
    const { t, workspaceId } = await setupBothProviders(["github"]);

    await t.run(async (ctx) => {
      expect(
        await getWorkspaceIntegrationByProvider(ctx, workspaceId, "gitlab"),
      ).toBeNull();
    });
  });

  it("does not reach across workspaces", async () => {
    const { t, workspaceId } = await setupBothProviders(["github"]);
    const other = await setupWorkspaceWithAdmin(t);

    await t.run(async (ctx) => {
      expect(
        await getWorkspaceIntegrationByProvider(
          ctx,
          other.workspaceId,
          "github",
        ),
      ).toBeNull();
      expect(
        await getWorkspaceIntegrationByProvider(ctx, workspaceId, "github"),
      ).not.toBeNull();
    });
  });
});
