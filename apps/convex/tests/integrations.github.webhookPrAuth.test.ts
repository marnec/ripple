/**
 * Sweep #9 — the GitHub pull-request route authorizes before it spends.
 *
 * The issue/comment path resolves the link first and drops unknown deliveries
 * without touching the network (`webhook.ts:114`). The PR path did the reverse:
 * it read `installation.id` straight off the body, minted an installation token
 * for it and ran a GraphQL query, and only then dispatched to the mutation
 * where `resolveActiveInboundLink` would discard the whole thing. Two costs,
 * both paid before any rule was consulted:
 *
 *  - the App's webhook secret is App-wide, so every delivery from every
 *    installation of the App passes the HMAC gate. An installation nobody
 *    connected to a workspace still made this deployment mint a token and burn
 *    shared GraphQL quota on each of its PR events.
 *  - `mintInstallationToken` throws on a non-2xx, which is what a *deleted*
 *    installation returns — so deliveries arriving in that window threw out of
 *    the bridge action, were retried three times and parked in the DLQ, against
 *    the contract stated at webhook.ts:92 ("never throws on delivered-but-
 *    irrelevant cases … so the component doesn't enter its retry/DLQ path").
 *
 * Everything here is driven through `receiveGithubWebhook`, the bridge the
 * receiver component actually calls, with `fetch` spied on: what is under test
 * is whether the route spends anything, and only the real entry point can
 * answer that.
 */

import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

const INSTALLATION_ID = 999_111;
const REPO_NODE_ID = "R_kgDOACME";
const ISSUE_NODE_ID = "I_kwDOABC123";
const ISSUE_NUMBER = 42;

/** A real key, because `signAppJwt` runs before the first HTTP call. */
let privateKeyPem = "";

beforeAll(async () => {
  const keypair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keypair.privateKey),
  );
  let bin = "";
  for (let i = 0; i < pkcs8.length; i++) bin += String.fromCharCode(pkcs8[i]);
  const b64 = btoa(bin);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
});

/** Every outbound request the delivery caused, in order. */
let calls: string[] = [];
/** What GitHub is pretending to be this test: the mint, then the graph. */
const github = {
  /** 404 is what a deleted installation's `/access_tokens` returns. */
  mintStatus: 201,
  closingIssueNodeIds: [] as string[],
};

beforeEach(() => {
  vi.stubEnv("GITHUB_APP_ID", "1");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKeyPem);
  calls = [];
  github.mintStatus = 201;
  github.closingIssueNodeIds = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      const json = (body: unknown, status: number) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
        );

      if (url.endsWith("/access_tokens")) {
        return github.mintStatus === 201
          ? json({ token: "ghs_test" }, 201)
          : json({ message: "Not Found" }, github.mintStatus);
      }
      return json(
        {
          data: {
            repository: {
              pullRequest: {
                closingIssuesReferences: {
                  nodes: github.closingIssueNodeIds.map((id) => ({ id })),
                },
              },
            },
          },
        },
        200,
      );
    }),
  );
  // The delivery schedules follow-up work (notification fanout); fake timers
  // let each test drain it before the context is torn down.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function openedPrPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    pull_request: {
      node_id: "PR_kwDO123",
      number: 7,
      title: "feat: fix dark mode crash",
      body: "",
      html_url: "https://github.com/acme/web/pull/7",
      draft: false,
      updated_at: "2026-05-20T10:00:00Z",
      head: { ref: "fix/dark-mode" },
      base: { ref: "main" },
      user: {
        login: "octocat",
        avatar_url: "https://github.com/octocat.png",
        html_url: "https://github.com/octocat",
      },
    },
    installation: { id: INSTALLATION_ID },
    repository: {
      node_id: REPO_NODE_ID,
      full_name: "acme/web",
      owner: { login: "acme" },
      name: "web",
    },
    ...overrides,
  };
}

/** Deliver one `pull_request` event the way the receiver component does. */
async function deliver(
  t: ReturnType<typeof createTestContext>,
  payload: Record<string, unknown> = openedPrPayload(),
) {
  await t.action(internal.integrations.github.webhook.receiveGithubWebhook, {
    provider: "github",
    rawBody: JSON.stringify(payload),
    headers: { "x-github-event": "pull_request" },
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

/** The same payload with a conventional `<issueNumber>-…` source branch. */
function prPayloadOnBranchForIssue(issueNumber: number) {
  const base = openedPrPayload();
  return {
    ...base,
    pull_request: {
      ...base.pull_request,
      head: { ref: `${issueNumber}-fix-dark-mode` },
    },
  };
}

/**
 * A workspace that connected this installation and linked the repo.
 * `opts.linkStatus` / `opts.pausedByBilling` drive the two non-active states.
 */
async function setupRouting(
  t: ReturnType<typeof createTestContext>,
  opts: {
    externalAccountId?: string;
    linkStatus?: "active" | "paused" | "disconnected";
    pausedByBilling?: boolean;
  } = {},
) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  const link = await t.run(async (ctx) => {
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: false,
      isCompleted: false,
      isTriage: true,
    });
    const botUserId = await ctx.db.insert("users", { name: "GitHub" });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: opts.externalAccountId ?? String(INSTALLATION_ID),
    });
    const linkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: opts.linkStatus ?? "active",
      pausedByBilling: opts.pausedByBilling ?? false,
      externalRepoFullName: "acme/web",
      externalRepoId: REPO_NODE_ID,
    });
    return (await ctx.db.get(linkId))!;
  });
  return { workspaceId, projectId, link };
}

/**
 * Import the issue the PR references, through the real inbound path — a PR that
 * attaches to nothing Ripple imported is never stored, so without this every
 * assertion below would read zero for the wrong reason.
 */
async function seedLinkedIssue(
  t: ReturnType<typeof createTestContext>,
  link: Doc<"projectIntegrationLinks">,
) {
  await t.run((ctx) =>
    applyNormalizedEvent(ctx, {
      event: {
        kind: "issue.opened",
        externalIssueId: ISSUE_NODE_ID,
        issueNumber: ISSUE_NUMBER,
        externalUpdatedAt: 1_700_000_000_000,
        title: "Dark mode crash",
        body: "repro",
        url: `https://github.com/acme/web/issues/${ISSUE_NUMBER}`,
        externalAuthor: {
          login: "octocat",
          avatarUrl: "https://github.com/octocat.png",
          url: "https://github.com/octocat",
        },
      },
      link,
    }),
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function pullRequestRows(t: ReturnType<typeof createTestContext>) {
  return await t.run(async (ctx) => ctx.db.query("pullRequests").collect());
}

describe("github pull_request delivery — authorization before the network", () => {
  /**
   * The third-party install. Nothing in the database knows this installation,
   * so the delivery is dropped either way — the question is only whether it is
   * dropped before or after a token mint and a GraphQL query.
   */
  it("spends nothing on an installation no workspace has connected", async () => {
    const t = createTestContext();

    await deliver(t);

    expect(calls).toEqual([]);
    expect(await pullRequestRows(t)).toHaveLength(0);
  });

  /**
   * The bound on the pre-filter: a delivery that IS ours must still take the
   * GraphQL hop, because the closing-issue graph is the one PR→task signal that
   * exists nowhere in the REST payload. A pre-filter that quietly refused a
   * live link would show up here and nowhere else.
   */
  it("still resolves closing issues for a connected installation", async () => {
    const t = createTestContext();
    const { link } = await setupRouting(t);
    await seedLinkedIssue(t, link);
    github.closingIssueNodeIds = [ISSUE_NODE_ID];

    // The PR's branch and text reference nothing, so the closing graph is the
    // ONLY signal that can attach it — a stored PR row means the hop ran and
    // its answer was used.
    await deliver(t);

    expect(calls).toEqual([
      `https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`,
      "https://api.github.com/graphql",
    ]);
    expect(await pullRequestRows(t)).toHaveLength(1);
  });

  /**
   * The half the pre-filter cannot cover. An installation the user just deleted
   * is still connected as far as this deployment knows — the `installation.
   * deleted` event has not landed yet — so its in-flight PR deliveries are
   * authorized, reach the mint, and get a 404. That used to throw out of the
   * bridge action, which the receiver retries three times before parking the
   * delivery in the DLQ: a self-inflicted DLQ fill from a path whose stated
   * contract is to drop cleanly.
   *
   * A lost closing graph is a degraded signal, not a failed delivery: the
   * branch number and `Closes #N` keywords are parsed from the payload and
   * still resolve, so the PR attaches to its task with no network at all.
   */
  it("degrades instead of throwing when the installation token cannot be minted", async () => {
    const t = createTestContext();
    const { link } = await setupRouting(t);
    await seedLinkedIssue(t, link);
    github.mintStatus = 404;

    await deliver(t, prPayloadOnBranchForIssue(ISSUE_NUMBER));

    expect(calls).toEqual([
      `https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`,
    ]);
    const prs = await pullRequestRows(t);
    expect(prs).toHaveLength(1);
    expect(prs[0].number).toBe(7);
  });

  /**
   * The pre-filter has to ask the same three questions the mutation's gate
   * asks, in the same order — otherwise a workspace whose billing lapsed keeps
   * costing GraphQL quota on every PR event for a delivery that is dropped on
   * arrival. Freeze is the question most easily left out of a "cheap" check:
   * the route's existing `isInstallationFrozen` pre-check does not cover this
   * path, since an unknown installation resolves to "not frozen".
   */
  it("spends nothing when the link is entitlement-frozen", async () => {
    const t = createTestContext();
    const { link } = await setupRouting(t, { pausedByBilling: true });
    await seedLinkedIssue(t, link);
    github.closingIssueNodeIds = [ISSUE_NODE_ID];

    await deliver(t);

    expect(calls).toEqual([]);
    expect(await pullRequestRows(t)).toHaveLength(0);
  });
});
