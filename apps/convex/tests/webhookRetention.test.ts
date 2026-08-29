/**
 * Sweep #14 — retention for the webhook receiver component's own tables.
 *
 * Both webhook routes declare a 30-day `expiresInMs`, which the component
 * writes as `expiresAt` on `webhookEvents` and `webhookDedup` — and then
 * nothing ever read it. The component ships a sweeper but registers it as an
 * `internalMutation`, so it is absent from the component's export table and
 * unreachable from this app (see `patches/convex-webhook-receiver@1.0.6.patch`,
 * which makes it public and pages it). The declared retention policy was simply
 * not the one that ran: every delivery's full raw body and header map — the
 * plaintext `x-gitlab-token` / `x-hub-signature-256` included — was kept
 * forever.
 *
 * Driven through the real HTTP route and the component's own public queries,
 * because that is the only view of those tables this app has.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, setupWorkspaceWithAdmin, setupProject } from "./helpers";
import { components, internal } from "../convex/_generated/api";

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date("2026-08-14T00:00:00Z").getTime();
const SECRET = "per-hook-secret-value";
const REPO_ID = "42";

/**
 * The dead-letter seam. A delivery only reaches the DLQ by failing every
 * attempt, and since the route now parses the body itself, an unparseable one
 * is refused before it is ever stored — so the failure has to be injected where
 * production's actually are: inside the reconciler the handler calls.
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

/**
 * A live GitLab link. Required since sweep #15 — the route authenticates the
 * per-hook token against a resolved link before anything is stored, so there is
 * no longer any way to put a row in these tables without one.
 */
async function setupLink(t: ReturnType<typeof createTestContext>) {
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

/** A genuine, authenticated inbound delivery — the row this policy is about. */
async function deliver(t: ReturnType<typeof createTestContext>, uuid: string) {
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

/** Ids of every stored (not-yet-expired) event, newest deliveries included. */
async function liveEventIds(t: ReturnType<typeof createTestContext>): Promise<string[]> {
  // Same as `listDlq` in webhookDlqMirror: the component query is `any` here.
  const events: Array<{ _id: string }> = await t.run((ctx) =>
    ctx.runQuery(components.webhookReceiver.event.queries.listEvents, {}),
  );
  return events.map((e) => e._id);
}

async function eventExists(
  t: ReturnType<typeof createTestContext>,
  eventId: string,
) {
  const event = await t.run((ctx) =>
    ctx.runQuery(components.webhookReceiver.event.queries.getEvent, { eventId }),
  );
  return event !== null;
}

async function prune(
  t: ReturnType<typeof createTestContext>,
  args: { batchSize?: number } = {},
) {
  await t.mutation(internal.webhookMaintenance.pruneWebhookEvents, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("webhook retention", () => {
  /**
   * The policy the routes declare, finally enforced. A body past its 30 days is
   * gone; one still inside the window is untouched, because the receiver's own
   * replay and dedup paths both read it.
   */
  it("deletes expired deliveries and keeps live ones", async () => {
    const t = createTestContext();
    await setupLink(t);

    await deliver(t, "delivery-old");
    const [oldId] = await liveEventIds(t);
    expect(oldId).toBeDefined();

    vi.setSystemTime(START + 31 * DAY_MS);
    await deliver(t, "delivery-new");
    const newId = (await liveEventIds(t)).find((id) => id !== oldId);
    expect(newId).toBeDefined();

    await prune(t);

    expect(await eventExists(t, oldId)).toBe(false);
    expect(await eventExists(t, newId!)).toBe(true);
  });

  /**
   * The dedup table has the same `expiresAt` and the same leak, and no query to
   * read it through — so it is asserted by behaviour. A dedup row outliving its
   * event would reject the delivery id forever; one swept alongside its event
   * lets the same id be accepted again, which is what "expired" has to mean.
   */
  it("sweeps the dedup row alongside its event", async () => {
    const t = createTestContext();
    await setupLink(t);

    await deliver(t, "delivery-dup");
    // While the dedup row is live, a redelivery of the same id is refused.
    expect((await deliver(t, "delivery-dup")).status).toBe(400);

    vi.setSystemTime(START + 31 * DAY_MS);
    await prune(t);

    expect((await deliver(t, "delivery-dup")).status).toBe(200);
  });

  /**
   * The reason the sweep is paged at all. The component's own helper collects
   * every expired row into one transaction, so a deployment that has been
   * accumulating for months would blow the read limit on its first sweep and
   * then on every sweep after it — never making progress, which is worse than
   * never having swept. The drain re-schedules while a batch comes back full.
   */
  it("drains a backlog larger than one batch", async () => {
    const t = createTestContext();
    await setupLink(t);

    for (let i = 0; i < 5; i++) await deliver(t, `delivery-${i}`);
    const ids = await liveEventIds(t);
    expect(ids).toHaveLength(5);

    vi.setSystemTime(START + 31 * DAY_MS);
    await prune(t, { batchSize: 2 });

    for (const id of ids) expect(await eventExists(t, id)).toBe(false);
  });

  /**
   * The leak a sweep would otherwise create. A delivery that burns its attempts
   * is moved to the component's dead-letter queue, which has no `expiresAt` of
   * its own — so deleting the expired event on its own leaves a `webhookDlq`
   * row pointing at nothing, forever, and trades one unbounded table for
   * another. The DLQ entry goes when the event it names goes.
   */
  it("takes the dead-letter entry with the event it points at", async () => {
    const t = createTestContext();
    await setupLink(t);

    injected.syncInThrows = true;
    await deliver(t, "delivery-dead");
    const dlq = await t.run((ctx) =>
      ctx.runQuery(components.webhookReceiver.event.queries.listDlq, {}),
    );
    expect(dlq).toHaveLength(1);

    vi.setSystemTime(START + 31 * DAY_MS);
    await prune(t);

    expect(await eventExists(t, dlq[0].eventId)).toBe(false);
    expect(
      await t.run((ctx) =>
        ctx.runQuery(components.webhookReceiver.event.queries.listDlq, {}),
      ),
    ).toHaveLength(0);
  });
});
