import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * End-to-end tests for the picker's commit step. The action chains four
 * underlying operations:
 *   1. admin gate (queries the workspace role)
 *   2. token resolve (PAT branch in these tests — no refresh needed)
 *   3. `createLink` mutation (mints a webhook secret for gitlab)
 *   4. `createProjectHook` HTTP call to GitLab (mocked)
 *
 * The happy-path asserts the GitLab POST received the same secret the link
 * carries (`getLinkWebhookConfig`'s view). The rollback test forces the
 * webhook call to fail and asserts the link is marked disconnected so a
 * retry isn't blocked by the stale "globally unique externalRepoId" gate.
 */
const ENV = {
  GITLAB_OAUTH_CLIENT_ID: "cid",
  GITLAB_OAUTH_CLIENT_SECRET: "csec",
  GITLAB_OAUTH_REDIRECT_URI: "https://app.example/cb",
  CONVEX_SITE_URL: "https://app.example",
};

async function seedWorkspaceAndIntegration(
  t: ReturnType<typeof createTestContext>,
) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
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
  // Pre-existing GitLab install. PAT-style (no oauth refresh fields) so the
  // token client returns the stored token without needing the OAuth env.
  const botUserId = await t.run((ctx) =>
    ctx.db.insert("users", { name: "gitlab", isBot: true }),
  );
  await t.run((ctx) =>
    ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "gitlab",
      externalAccountId: "9999",
      credentialToken: "at-current",
    }),
  );
  return { workspaceId, projectId, asUser };
}

describe("integrations/gitlab/registerProjectAction.registerProject", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    for (const [k, v] of Object.entries(ENV)) {
      process.env[k] = v;
    }
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(ENV)) {
      delete process.env[k];
    }
  });

  it("creates the link and POSTs the hook to GitLab with the same secret", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, asUser } =
      await seedWorkspaceAndIntegration(t);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 12345 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const linkId = await asUser.action(
      api.integrations.gitlab.registerProjectAction.registerProject,
      {
        workspaceId,
        projectId,
        externalAccountId: "9999",
        gitlabProjectId: 42,
        pathWithNamespace: "acme/web",
      },
    );

    expect(linkId).toBeDefined();
    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.status).toBe("active");
    expect(link?.externalRepoFullName).toBe("acme/web");
    expect(link?.webhookSecret).toBeDefined();

    // Single hook POST landed on GitLab carrying the same secret.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://gitlab.com/api/v4/projects/42/hooks");
    const body = JSON.parse(String(init.body));
    expect(body.token).toBe(link?.webhookSecret);
    expect(body.url).toBe("https://app.example/integrations/gitlab/webhook");
    expect(body.issues_events).toBe(true);
    expect(body.merge_requests_events).toBe(true);
  });

  it("rolls back the link when GitLab rejects the hook registration", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, asUser } =
      await seedWorkspaceAndIntegration(t);

    fetchMock.mockResolvedValue(new Response("Forbidden", { status: 403 }));

    await expect(
      asUser.action(
        api.integrations.gitlab.registerProjectAction.registerProject,
        {
          workspaceId,
          projectId,
          externalAccountId: "9999",
          gitlabProjectId: 42,
          pathWithNamespace: "acme/web",
        },
      ),
    ).rejects.toThrow(/register the webhook/);

    // The link was created then rolled back — should be disconnected so the
    // next attempt isn't blocked by the externalRepoId uniqueness check.
    const links = await t.run((ctx) =>
      ctx.db
        .query("projectIntegrationLinks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(links).toHaveLength(1);
    expect(links[0].status).toBe("disconnected");
  });
});
