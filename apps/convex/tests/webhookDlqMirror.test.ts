/**
 * Sweep-b #11 — a dead inbound delivery has to reach an operator.
 *
 * An inbound webhook that fails every attempt is moved to the receiver
 * component's dead-letter queue, and nothing in Ripple ever read that table:
 * no `lastSyncError` chip (that surface is outbound-only), no
 * `backgroundJobFailures` row, nothing on `admin/jobs`. The task simply stays
 * diverged from the provider, and 30 days later `webhookMaintenance` deletes
 * the only trace that it happened.
 *
 * Driven end to end — a real authenticated POST on the GitLab route with the
 * reconciler throwing, then the cron step, then the operator's own guarded
 * query — because "an operator can see it" is the whole behaviour under test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
  setupProject,
} from "./helpers";
import { api, components, internal } from "../convex/_generated/api";

type T = ReturnType<typeof createTestContext>;

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date("2026-08-14T00:00:00Z").getTime();
const SECRET = "per-hook-secret-value";
const REPO_ID = "42";

/**
 * The dead-letter seam. The route parses and authenticates before it stores,
 * so a delivery can only die where production's actually do: inside the
 * reconciler the handler calls.
 */
const injected = vi.hoisted(() => ({ syncInThrows: false }));

vi.mock("../convex/integrations/core/syncIn", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../convex/integrations/core/syncIn")>();
  return {
    ...actual,
    applyNormalizedEvent: async (
      ...args: Parameters<typeof actual.applyNormalizedEvent>
    ) => {
      if (injected.syncInThrows) throw new Error("injected sync failure");
      return actual.applyNormalizedEvent(...args);
    },
  };
});

beforeEach(() => {
  injected.syncInThrows = false;
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

async function makePlatformAdmin(t: T) {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Platform Admin",
    email: "ops@example.com",
  });
  await t.run((ctx) => ctx.db.patch(userId, { isPlatformAdmin: true }));
  return asUser;
}

/** A live GitLab link — the route authenticates the per-hook token first. */
async function setupLink(t: T) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  await t.run(async (ctx) => {
    await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: REPO_ID,
      webhookSecret: SECRET,
    });
  });
}

/** A genuine, authenticated inbound delivery. */
async function deliver(t: T, uuid: string) {
  const res = await t.fetch("/integrations/gitlab/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-gitlab-event-uuid": uuid,
      "x-gitlab-event": "Issue Hook",
      "x-gitlab-token": SECRET,
    },
    body: JSON.stringify({
      object_kind: "issue",
      user: { id: 7, username: "octocat" },
      project: {
        id: REPO_ID,
        web_url: "https://gitlab.com/acme/web",
        path_with_namespace: "acme/web",
      },
      object_attributes: {
        id: 301,
        iid: 23,
        title: "Page crashes on dark mode",
        description: "repro steps",
        state: "opened",
        action: "open",
        url: "https://gitlab.com/acme/web/-/issues/23",
        updated_at: "2026-05-20 10:00:00 UTC",
      },
    }),
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return res;
}

// The component's query is typed `any` at this boundary, so name the shape the
// assertions actually read rather than letting `any` leak into them.
async function listDlq(t: T): Promise<Array<{ eventId: string }>> {
  return t.run((ctx) =>
    ctx.runQuery(components.webhookReceiver.event.queries.listDlq, {}),
  );
}

async function mirror(t: T, args: { batchSize?: number } = {}) {
  await t.mutation(internal.webhookDlqMirror.mirrorDeadDeliveries, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("webhook dead-letter mirror", () => {
  /**
   * The gap itself. A delivery Ripple could not apply burns its attempts, is
   * marked dead, and — until this ran — that was the end of it.
   */
  it("puts a dead inbound delivery on the operator's job list", async () => {
    const t = createTestContext();
    await setupLink(t);
    const asAdmin = await makePlatformAdmin(t);

    injected.syncInThrows = true;
    await deliver(t, "delivery-dead");
    const [dead] = await listDlq(t);
    expect(dead).toBeDefined();

    expect((await asAdmin.query(api.admin.jobs.list, {})).failures).toEqual([]);

    await mirror(t);

    const { failures } = await asAdmin.query(api.admin.jobs.list, {});
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      kind: "webhookReceiver:dead",
      key: dead.eventId,
    });
    expect(failures[0].error).toContain("injected sync failure");
  });

  /**
   * The cron runs daily and the DLQ entry lives for 30 days, so "mirror what
   * is there" would re-report the same dead delivery thirty times. Worse, it
   * would fight `admin.jobs.dismiss`: an operator who triages a row is meant
   * to be rid of it, and a list that cannot be emptied stops being read.
   */
  it("does not re-report a delivery it already mirrored, even after dismissal", async () => {
    const t = createTestContext();
    await setupLink(t);
    const asAdmin = await makePlatformAdmin(t);

    injected.syncInThrows = true;
    await deliver(t, "delivery-dead");

    await mirror(t);
    const { failures } = await asAdmin.query(api.admin.jobs.list, {});
    expect(failures).toHaveLength(1);

    // A second day's run, with the entry still in its 30-day DLQ window.
    await mirror(t);
    expect((await asAdmin.query(api.admin.jobs.list, {})).failures).toHaveLength(
      1,
    );

    // The operator triages it. It must stay gone.
    await asAdmin.mutation(api.admin.jobs.dismiss, {
      failureId: failures[0]._id,
    });
    await mirror(t);
    expect((await asAdmin.query(api.admin.jobs.list, {})).failures).toEqual([]);
  });

  /**
   * Why the run is paged. Naming a dead delivery means reading the event it
   * points at, and those rows carry the complete raw body — issue and PR
   * payloads run 20–80 KB. A repo whose payload shape Ripple cannot apply
   * produces a *run* of dead deliveries, not one, so the first mirror after a
   * bad day would try to read the whole backlog in a single transaction. It
   * pages instead, the way `pruneWebhookEvents` does, and every entry is
   * reported exactly once across the continuations.
   */
  it("drains a backlog larger than one batch, reporting each entry once", async () => {
    const t = createTestContext();
    await setupLink(t);
    const asAdmin = await makePlatformAdmin(t);

    injected.syncInThrows = true;
    for (let i = 0; i < 5; i++) await deliver(t, `delivery-dead-${i}`);
    const dead = await listDlq(t);
    expect(dead).toHaveLength(5);

    // One transaction takes a bounded bite …
    await t.mutation(internal.webhookDlqMirror.mirrorDeadDeliveries, {
      batchSize: 2,
    });
    expect((await asAdmin.query(api.admin.jobs.list, {})).failures).toHaveLength(
      2,
    );

    // … and finishes the backlog on its own continuations.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const { failures } = await asAdmin.query(api.admin.jobs.list, {});
    expect(failures.map((f) => f.key).sort()).toEqual(
      dead.map((d) => d.eventId).sort(),
    );
  });

  /**
   * The half of the finding retention created. `pruneWebhookEvents` takes the
   * dead-letter entry with the event it names, so the DLQ is a 30-day window
   * on a failure and not a record of one. The operator's row has to outlive
   * it — the mirror runs daily and an entry is written the moment a delivery
   * dies, a full retention period before the sweep can reach it.
   */
  it("leaves a report that outlives the retention sweep", async () => {
    const t = createTestContext();
    await setupLink(t);
    const asAdmin = await makePlatformAdmin(t);

    injected.syncInThrows = true;
    await deliver(t, "delivery-dead");
    await mirror(t);

    vi.setSystemTime(START + 31 * DAY_MS);
    await t.mutation(internal.webhookMaintenance.pruneWebhookEvents, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The component's own record of the failure is gone, as the policy says.
    expect(await listDlq(t)).toHaveLength(0);
    // The operator's is not.
    const { failures } = await asAdmin.query(api.admin.jobs.list, {});
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe("webhookReceiver:dead");
  });
});
