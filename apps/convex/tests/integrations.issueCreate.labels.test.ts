import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { withTriggers } from "../convex/dbTriggers";

/**
 * Creating an issue from a tagged task sends the tags in the create call
 * itself (ticket 06). Before, the create sent only title and body and the
 * tags trickled over on a later edit, if ever. Driven through the real action
 * with a stubbed GitHub, because what matters is the wire body and the link
 * row the recorder writes from it.
 */
async function generateTestKeyPem(): Promise<string> {
  const keypair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keypair.privateKey);
  const bytes = new Uint8Array(pkcs8);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/** A GitHub that finds nothing upstream and accepts the create. */
function stubGithub() {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/access_tokens")) {
        return new Response(JSON.stringify({ token: "ghs_test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if ((init?.method ?? "GET") === "POST") {
        posts.push({ url: u, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
        return new Response(
          JSON.stringify({
            node_id: "I_created",
            number: 77,
            updated_at: "2026-05-26T10:00:00Z",
            user: { login: "ripple[bot]", avatar_url: "", html_url: "" },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      // Marker precheck (`GET /repos/:repo/issues`): no prior issue.
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return posts;
}

async function taskWithTags(
  t: ReturnType<typeof createTestContext>,
  tags: string[],
) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  const { taskId, projectLinkId } = await t.run(async (ctx) => {
    const botUserId = await ctx.db.insert("users", { name: "GitHub", isBot: true });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId, botUserId, provider: "github", externalAccountId: "install-1",
    });
    const projectLinkId = await ctx.db.insert("projectIntegrationLinks", {
      projectId, workspaceId, status: "active", pausedByBilling: false,
      externalRepoId: "R_kg1", externalRepoFullName: "acme/web",
    });
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
    });
    // Through the triggers so `labels` fans out to the tag tables as in the app.
    const taskId = await withTriggers(ctx).db.insert("tasks", {
      projectId, workspaceId, title: "Tagged task", statusId, priority: "medium",
      completed: false, creatorId: userId, labels: tags,
    });
    return { taskId, projectLinkId };
  });
  return { asUser, taskId, projectLinkId };
}

describe("tasks.createGithubIssue — labels travel with the create", () => {
  let savedAppId: string | undefined;
  let savedKey: string | undefined;
  beforeEach(async () => {
    vi.useFakeTimers();
    savedAppId = process.env.GITHUB_APP_ID;
    savedKey = process.env.GITHUB_APP_PRIVATE_KEY;
    process.env.GITHUB_APP_ID = "1";
    process.env.GITHUB_APP_PRIVATE_KEY = await generateTestKeyPem();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (savedAppId === undefined) delete process.env.GITHUB_APP_ID;
    else process.env.GITHUB_APP_ID = savedAppId;
    if (savedKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
    else process.env.GITHUB_APP_PRIVATE_KEY = savedKey;
  });

  it("sends the task's tags in the create call and mirrors them on the new link", async () => {
    const t = createTestContext();
    const { asUser, taskId, projectLinkId } = await taskWithTags(t, ["bug", "p1"]);
    const posts = stubGithub();

    await asUser.mutation(api.tasks.createGithubIssue, {
      taskId,
      projectIntegrationLinkId: projectLinkId,
      title: "Tagged task",
      body: "",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(posts).toHaveLength(1);
    expect(posts[0].body.labels).toEqual(["bug", "p1"]);
    const link = await t.run((ctx) =>
      ctx.db.query("taskIntegrationLinks").withIndex("by_task", (q) => q.eq("taskId", taskId)).unique(),
    );
    expect(link?.externalIssueId).toBe("I_created");
    expect(link?.externalLabels).toEqual(["bug", "p1"]);
  });

  it("an untagged task sends no labels and leaves the mirror unset, as before", async () => {
    const t = createTestContext();
    const { asUser, taskId, projectLinkId } = await taskWithTags(t, []);
    const posts = stubGithub();

    await asUser.mutation(api.tasks.createGithubIssue, {
      taskId,
      projectIntegrationLinkId: projectLinkId,
      title: "Untagged",
      body: "",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(posts).toHaveLength(1);
    expect("labels" in posts[0].body).toBe(false);
    const link = await t.run((ctx) =>
      ctx.db.query("taskIntegrationLinks").withIndex("by_task", (q) => q.eq("taskId", taskId)).unique(),
    );
    expect(link?.externalLabels ?? undefined).toBeUndefined();
  });
});
