/**
 * T6 phase 3 — the drains.
 *
 * A scheduled *action* is at-most-once: Convex does not retry it, and its
 * failure is invisible outside `_scheduled_functions`. Every paged drain in
 * this codebase is a scheduled action, so a single thrown page used to abandon
 * the whole convergence silently. These tests pin the two properties that
 * replace that: the pool retries the drain, and a drain that gives up leaves a
 * row somebody can read.
 *
 * Failures are injected by wrapping the *page* function each drain calls —
 * the same seam production fails at (a transaction cap, an OCC conflict, a
 * transient read failure), one level below the entry point under test.
 */

import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "../convex/dbTriggers";
import { createTestContext, setupProject, setupWorkspaceWithAdmin } from "./helpers";
import { api, internal } from "../convex/_generated/api";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import type { Id } from "../convex/_generated/dataModel";

/**
 * Calendar mail's failure seam. `emails.ts` sends through the raw `resend`
 * client (the component's batch endpoint cannot carry the ICS), so this is the
 * one place a Resend outage is injectable without mocking anything of ours.
 */
const sendEmail = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: (payload: unknown, options?: unknown) => sendEmail(payload, options),
    };
  },
}));

/**
 * Page control for the open-channel fanout.
 *
 * `pagesPerAttempt` holds `isDone` false so a three-member workspace drains in
 * as many pages as a three-thousand-member one — the real page size is 200, and
 * seeding 400 members to observe a mid-drain failure would buy nothing the
 * forced boundary does not. `failOnPage` then throws at a page boundary the way
 * a transaction cap or an OCC conflict does, after earlier pages have
 * committed. A restart is recognised by `cursor === null`, which is exactly how
 * the drain begins an attempt.
 */
const injected = vi.hoisted(() => ({
  pagesPerAttempt: 1,
  /** 1-based page that throws, once. Cleared as it fires, so the retry runs. */
  failOnPage: null as number | null,
  /** Every page throws, on every attempt — the retries-exhausted case. */
  failEveryPage: false,
  pageIndex: 0,
  /** Push delivery: make it throw, and count how often it was attempted. */
  pushThrows: false,
  pushFailures: 0,
}));

vi.mock("../convex/utils/sendPushToUsers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../convex/utils/sendPushToUsers")>();
  const fail = () => {
    injected.pushFailures += 1;
    throw new Error("injected push failure");
  };
  return {
    ...actual,
    sendPushToUsers: async (
      ...args: Parameters<typeof actual.sendPushToUsers>
    ) => (injected.pushThrows ? fail() : actual.sendPushToUsers(...args)),
    sendPushToFilteredUsers: async (
      ...args: Parameters<typeof actual.sendPushToFilteredUsers>
    ) => (injected.pushThrows ? fail() : actual.sendPushToFilteredUsers(...args)),
  };
});

vi.mock("../convex/notificationSubscriptionSync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../convex/notificationSubscriptionSync")>();
  return {
    ...actual,
    subscribeChannelMembersPage: async (
      ...args: Parameters<typeof actual.subscribeChannelMembersPage>
    ) => {
      const cursor = args[3];
      if (cursor === null) injected.pageIndex = 0;
      injected.pageIndex += 1;
      const page = injected.pageIndex;

      if (injected.failEveryPage) throw new Error("injected page failure");
      if (injected.failOnPage === page) {
        injected.failOnPage = null;
        throw new Error("injected page failure");
      }

      const result = await actual.subscribeChannelMembersPage(...args);
      return page < injected.pagesPerAttempt
        ? { cursor: result.cursor, isDone: false }
        : result;
    },
  };
});

beforeEach(() => {
  injected.pagesPerAttempt = 1;
  injected.failOnPage = null;
  injected.failEveryPage = false;
  injected.pageIndex = 0;
  injected.pushThrows = false;
  injected.pushFailures = 0;
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ data: { id: "resend-1" }, error: null });
  vi.stubEnv("AUTH_RESEND_KEY", "re_test_key");
  vi.stubEnv("RESEND_TEST_MODE", "false");
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function drain(t: ReturnType<typeof createTestContext>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

/** Extra workspace members, inserted raw so only the channel trigger fans out. */
async function seedMembers(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Id<"workspaces">,
  count: number,
) {
  return await t.run(async (ctx) => {
    const ids: Id<"users">[] = [];
    for (let i = 0; i < count; i++) {
      const userId = await ctx.db.insert("users", {
        name: `Member ${i}`,
        email: `member${i}@example.com`,
      });
      await ctx.db.insert("workspaceMembers", {
        userId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
      ids.push(userId);
    }
    return ids;
  });
}

async function createOpenChannel(
  t: ReturnType<typeof createTestContext>,
  workspaceId: Id<"workspaces">,
) {
  return await t.run(async (ctx) => {
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    return await db.insert("channels", {
      name: "general",
      workspaceId,
      type: "open" as const,
    });
  });
}

/**
 * The subscriptions the fanout produced, as id-free `member:category` keys so
 * two separate runs can be compared row for row. Duplicates survive the mapping
 * — that is the point: a replayed page that double-subscribed someone shows up
 * here as a repeated key, not as a silently-deduplicated set.
 */
async function fanoutKeys(
  t: ReturnType<typeof createTestContext>,
  channelId: Id<"channels">,
) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("notificationSubscriptions")
      .withIndex("by_scope_category", (q) => q.eq("scope", channelId))
      .collect();
    const keys = await Promise.all(
      rows.map(async (row) => {
        const user = await ctx.db.get(row.userId);
        return `${user?.name ?? "?"}:${row.category}`;
      }),
    );
    return keys.sort();
  });
}

/** One full three-page fanout, optionally failing at the given page. */
async function runFanout(opts: { failOnPage?: number } = {}) {
  const t = createTestContext();
  const { workspaceId } = await setupWorkspaceWithAdmin(t);
  await seedMembers(t, workspaceId, 2);

  injected.pagesPerAttempt = 3;
  injected.failOnPage = opts.failOnPage ?? null;
  const channelId = await createOpenChannel(t, workspaceId);
  await drain(t);

  return await fanoutKeys(t, channelId);
}

describe("open-channel subscription fanout", () => {
  /**
   * That the drain is retried at all. The failure lands on the first page, so
   * nothing has committed when it throws: an at-most-once scheduled action
   * leaves the channel with zero subscriptions, which is what this drain did
   * before it went through a pool. The uninterrupted run is the source of
   * truth, so the assertion cannot drift as the category list changes.
   */
  it("still subscribes everyone when the first page throws", async () => {
    const uninterrupted = await runFanout();
    const interrupted = await runFanout({ failOnPage: 1 });

    expect(uninterrupted.length).toBeGreaterThan(0);
    expect(interrupted).toEqual(uninterrupted);
  });

  /**
   * The restart-safety claim, and the reason plain retry is enough here instead
   * of a persisted cursor: a retry resumes from `cursor: null`, so every page
   * that already committed runs a second time. Failing page 2 of 3 puts a
   * committed page 1 behind the failure and then replays it. Nobody ends up
   * subscribed twice because `insertSubscription` reads before it writes — were
   * that to change, this test fails with doubled keys, which is precisely the
   * regression the comment on `scheduleSubscriptionDrain` warns about.
   */
  it("does not double-subscribe when a replayed page runs again", async () => {
    const uninterrupted = await runFanout();
    const interrupted = await runFanout({ failOnPage: 2 });

    expect(uninterrupted.length).toBeGreaterThan(0);
    expect(interrupted).toEqual(uninterrupted);
  });

  /**
   * Retry is only half the answer: a drain that fails every attempt has still
   * given up, and the whole point of this theme is that giving up leaves a
   * trace on a row rather than a line in a 7-day log. The row has to name both
   * the drain and the thing it was draining, or "work that gave up" is not
   * actionable.
   */
  it("records a background job failure once retries are exhausted", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);

    injected.failEveryPage = true;
    const channelId = await createOpenChannel(t, workspaceId);
    await drain(t);

    const failures = await t.run(async (ctx) =>
      ctx.db.query("backgroundJobFailures").collect(),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe(
      "notificationSubscriptionJobs:publicChannelCreated",
    );
    expect(failures[0].key).toBe(channelId);
    expect(failures[0].error).toContain("injected page failure");
    expect(failures[0].failedAt).toEqual(expect.any(Number));
  });
});

describe("push delivery", () => {
  /**
   * The boundary of this theme, pinned so it is not "fixed" later. Everything
   * else here gained retry; `deliverPush` deliberately did not. A push has no
   * dedupe key on the delivery side, so a retried fan-out re-notifies everyone
   * the failed attempt already reached — and a duplicate buzz is worse for the
   * recipient than a notification they never knew was missing.
   *
   * A failure here is also not a `backgroundJobFailures` row: nothing gave up
   * on work it promised to finish, because at-most-once never promised it.
   */
  it("is attempted once and not retried when delivery throws", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await seedMembers(t, workspaceId, 1);

    const channelId = await createOpenChannel(t, workspaceId);
    await drain(t);

    injected.pushFailures = 0;
    injected.pushThrows = true;
    await asUser.mutation(api.messages.send, {
      isomorphicId: "push-retry-probe",
      body: JSON.stringify([
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      ]),
      plainText: "hello",
      channelId,
    });
    await drain(t);

    expect(injected.pushFailures).toBe(1);
    const failures = await t.run(async (ctx) =>
      ctx.db.query("backgroundJobFailures").collect(),
    );
    expect(failures).toHaveLength(0);
  });
});

describe("tag-delete drain", () => {
  /**
   * A workspace holding one tag the drain can never finish.
   *
   * The failure is driven by data rather than a mock, because that is what the
   * batch can actually hit: a join row pointing at a row of another table makes
   * the strip's patch fail schema validation, on every attempt, exactly as a
   * genuinely undrainable batch would.
   */
  async function seedUndrainableTag(t: ReturnType<typeof createTestContext>) {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const documentId = await asUser.mutation(api.documents.create, { workspaceId });
    await asUser.mutation(api.documents.updateTags, {
      id: documentId,
      tags: ["ops"],
    });
    const tagId = await t.run(async (ctx) => {
      const tag = await ctx.db
        .query("tags")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .unique();
      // A join whose resourceId is the workspace itself: the strip patches
      // `tags` onto a row whose schema has no such field.
      await ctx.db.insert("entityTags", {
        workspaceId,
        tagId: tag!._id,
        tagName: tag!.name,
        resourceType: "document",
        resourceId: workspaceId,
      });
      return tag!._id;
    });

    return { workspaceId, asUser, tagId };
  }

  /**
   * The second family of drains — the ones already on `taskReassignPool`,
   * which until now had the pool but not the retry. `deleteTag` retires the
   * dictionary row immediately and leaves the strip to the drain, so a drain
   * that dies takes the tag off every picker while leaving it on every
   * resource: the worst of both states, and previously invisible.
   */
  it("records a background job failure when a batch keeps throwing", async () => {
    const t = createTestContext();
    const { asUser, tagId } = await seedUndrainableTag(t);

    await asUser.mutation(api.tagSync.deleteTag, { tagId });
    await drain(t);

    const failures = await t.run(async (ctx) =>
      ctx.db.query("backgroundJobFailures").collect(),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe("tagSync:stripTagEverywhere");
    expect(failures[0].key).toBe(tagId);
  });

  /**
   * Recording the give-up is only half of it. `pendingDeletion` is what took
   * the tag off every picker, and nothing else in the codebase ever clears it,
   * so an exhausted drain used to leave that state permanent: the tag stays on
   * every resource, is gone from every picker, and `getOrCreateTag` refuses the
   * name forever. Giving up has to put the workspace back where it started.
   */
  it("returns the tag to the picker when the drain gives up", async () => {
    const t = createTestContext();
    const { workspaceId, asUser, tagId } = await seedUndrainableTag(t);

    await asUser.mutation(api.tagSync.deleteTag, { tagId });
    await drain(t);

    expect(
      await asUser.query(api.tags.listWorkspaceTags, { workspaceId }),
    ).toContain("ops");
  });
});

/**
 * The status half of the same give-up, driven at the seam the pool itself calls
 * rather than end to end: `fetchTasksForStatusBatch` patches one indexed field
 * and touches no trigger that can be made to fail on data, so the only way to
 * exhaust the drain from outside would be to mock the batch — which means
 * copying the production batch into the test to keep the success path working.
 * `recordEmailTerminalFailure` is exercised the same way below, for the same
 * reason: what is under test is the pool's terminal contract, not the route to
 * it, and the tag suite above already proves the pool calls this handler.
 */
describe("status-delete drain", () => {
  /** A project with a column being deleted into another, drain not yet run. */
  async function startStatusDelete(t: ReturnType<typeof createTestContext>) {
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

    const statusId = await asUser.mutation(api.taskStatuses.create, {
      projectId,
      name: "In Review",
      color: "bg-amber-500",
      isCompleted: false,
    });
    const targetId = await asUser.mutation(api.taskStatuses.create, {
      projectId,
      name: "Done",
      color: "bg-green-500",
      isCompleted: true,
    });
    await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Ship it",
      statusId,
    });

    await asUser.mutation(api.taskStatuses.remove, {
      statusId,
      reassignToStatusId: targetId,
    });

    return { projectId, asUser, statusId, targetId };
  }

  /** The pool's terminal callback for a drain that spent every attempt. */
  async function giveUp(
    t: ReturnType<typeof createTestContext>,
    context: { kind: string; key: string },
  ) {
    await t.mutation(internal.taskReassignRecovery.recordDrainGiveUp, {
      workId: "work-1" as never,
      context,
      result: { kind: "failed", error: "Too many write conflicts" },
    });
  }

  async function statusNames(
    t: ReturnType<typeof createTestContext>,
    asUser: Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["asUser"],
    projectId: Id<"projects">,
  ) {
    const statuses = await asUser.query(api.taskStatuses.listByProject, {
      projectId,
    });
    return statuses.map((s) => s.name);
  }

  /**
   * The wedge itself. `pendingDeletion` is what takes the column off the board,
   * and the board is grouped by `statusId`, so a column hidden while its tasks
   * still point at it does not merely disappear — it takes those tasks with it,
   * for every member, with no error anywhere in the product.
   */
  it("returns the column to the board when the drain gives up", async () => {
    const t = createTestContext();
    const { projectId, asUser, statusId } = await startStatusDelete(t);

    expect(await statusNames(t, asUser, projectId)).not.toContain("In Review");

    await giveUp(t, {
      kind: "taskStatuses:reassignTasksAndDelete",
      key: statusId,
    });

    expect(await statusNames(t, asUser, projectId)).toContain("In Review");
  });

  /**
   * And the second half: the delete has to be re-pressable. Before this, the
   * guard in `remove` read a flag nothing could clear, so the one recovery
   * available to a user was refused for the lifetime of the project.
   */
  it("lets the delete be retried after the drain gives up", async () => {
    const t = createTestContext();
    const { projectId, asUser, statusId, targetId } = await startStatusDelete(t);

    await giveUp(t, {
      kind: "taskStatuses:reassignTasksAndDelete",
      key: statusId,
    });
    await asUser.mutation(api.taskStatuses.remove, {
      statusId,
      reassignToStatusId: targetId,
    });
    await drain(t);

    expect(await statusNames(t, asUser, projectId)).toEqual(["Done"]);
    const tasks = await t.run(async (ctx) => ctx.db.query("tasks").collect());
    expect(tasks.map((task) => task.statusId)).toEqual([targetId]);
  });

  /**
   * The dispatch is on `kind`, not on "does this key name a status". Both
   * drains keyed by a status id come through here, and only the delete retired
   * the row: a failed `isCompleted` sync clearing `pendingDeletion` would
   * un-retire a column whose delete drain is still running, putting it back on
   * the board minutes before it is deleted for real.
   */
  it("leaves the flag alone when a different drain on the same status gives up", async () => {
    const t = createTestContext();
    const { projectId, asUser, statusId } = await startStatusDelete(t);

    await giveUp(t, { kind: "taskStatuses:syncTasksCompleted", key: statusId });

    expect(await statusNames(t, asUser, projectId)).not.toContain("In Review");
  });
});

/**
 * The third family — `emailPool`. It is the one drain whose give-up is visible
 * to a *user* and not only to an operator: `deliveryStatus` is what the guest
 * list renders, and `waiting` there means "still going out", which is exactly
 * the wrong thing to say about mail that will never be attempted again.
 *
 * `sendTrackedEmail` deliberately leaves the row alone on a transient failure —
 * an attempt still in flight must not read as a failure — so the only place the
 * row can learn that the last attempt was also the final one is the pool's
 * `onComplete`. Both halves are asserted, because either alone is a half-fix:
 * the `backgroundJobFailures` row is what an operator reads, the `failed`
 * status is what the organizer reads.
 */
describe("calendar mail", () => {
  /** Invite one guest with Resend failing transiently for good. */
  async function inviteGuestThroughOutage(
    t: ReturnType<typeof createTestContext>,
  ) {
    // Retryable per `classifyResendError`, so every attempt rethrows plain and
    // the pool spends all five — the ~30s Resend blip the pool exists for.
    sendEmail.mockResolvedValue({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Too many requests" },
    });
    return await inviteOneGuest(t);
  }

  async function inviteOneGuest(t: ReturnType<typeof createTestContext>) {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId,
      title: "Q3 planning",
      startsAt: Date.UTC(2026, 7, 20, 9, 0),
      endsAt: Date.UTC(2026, 7, 20, 10, 0),
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: ["guest@example.com"] },
    });
    await drain(t);

    const invitee = await t.run(async (ctx) =>
      ctx.db
        .query("calendarEventInvitees")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .unique(),
    );
    return invitee!;
  }

  async function jobFailures(t: ReturnType<typeof createTestContext>) {
    return await t.run(async (ctx) =>
      ctx.db.query("backgroundJobFailures").collect(),
    );
  }

  it("records a background job failure once retries are exhausted", async () => {
    const t = createTestContext();
    const invitee = await inviteGuestThroughOutage(t);

    const failures = await jobFailures(t);
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe("emails:sendEventInvite");
    expect(failures[0].key).toBe(invitee._id);
    expect(failures[0].error).toContain("Too many requests");
    expect(failures[0].failedAt).toEqual(expect.any(Number));
  });

  it("moves the invitee row off `waiting` once retries are exhausted", async () => {
    const t = createTestContext();
    const invitee = await inviteGuestThroughOutage(t);

    expect(invitee.deliveryStatus).toBe("failed");
    expect(invitee.deliveryError).toContain("Too many requests");
  });

  /**
   * The other way a send gives up. A permanent failure stops on the first
   * attempt and writes its own classified reason on the way out — quota reads
   * as quota — but it too reached no operator surface before this change: the
   * organizer saw `failed`, `admin/jobs` saw nothing. Both are asserted, and
   * the reason has to survive the `onComplete` that now runs behind it.
   */
  it("records the give-up for a permanent failure without rewording it", async () => {
    const t = createTestContext();
    sendEmail.mockResolvedValue({
      data: null,
      error: { name: "daily_quota_exceeded", message: "Daily quota reached" },
    });

    const invitee = await inviteOneGuest(t);

    expect(invitee.deliveryStatus).toBe("failed");
    // Exactly, not merely containing "quota": what the pool hands `onComplete`
    // is the serialized `NonRetryableError` and it contains the word too.
    expect(invitee.deliveryError).toBe(
      "Email quota exhausted: Daily quota reached",
    );
    expect(await jobFailures(t)).toHaveLength(1);
  });

  /**
   * Misconfiguration, which is the same silent drop reached without any Resend
   * involvement at all: `resolveTestMode` throws before the send is entered, so
   * there is no classified failure, the rethrow reads as transient, and all
   * five attempts are spent on an error no attempt could have fixed. The row
   * never even reaches `waiting` here — nothing stamped it — which is the other
   * state the give-up has to be willing to correct.
   */
  it("records the give-up when a deployment is missing its mail config", async () => {
    const t = createTestContext();
    vi.stubEnv("RESEND_TEST_MODE", "");

    const invitee = await inviteOneGuest(t);

    expect(invitee.deliveryStatus).toBe("failed");
    expect(invitee.deliveryError).toContain("RESEND_TEST_MODE");
    expect(await jobFailures(t)).toHaveLength(1);
  });

  /**
   * The bound on what the give-up may overwrite, driven at the seam the pool
   * itself calls because the race is not reachable from a mutation: the send
   * hands the message to Resend and then throws on the bookkeeping behind it.
   * The pool retries what it sees as a failed attempt while the mail that did
   * go out is delivered, and the webhook lands `delivered` on the row. Were the
   * give-up to restate that as `failed`, the organizer would be told mail was
   * never sent that their guest is looking at.
   *
   * The operator record is written either way — the job did give up, whatever
   * became of the message.
   */
  it("does not overwrite a delivery the webhook already resolved", async () => {
    const t = createTestContext();
    const invitee = await inviteOneGuest(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(invitee._id, { deliveryStatus: "delivered" });
    });

    await t.mutation(internal.emailDelivery.recordEmailTerminalFailure, {
      workId: "work-1" as never,
      context: {
        kind: "emails:sendEventInvite",
        key: invitee._id,
        inviteeId: invitee._id,
      },
      result: { kind: "failed", error: "Bookkeeping write failed" },
    });

    const after = await t.run(async (ctx) => await ctx.db.get(invitee._id));
    expect(after?.deliveryStatus).toBe("delivered");
    expect(after?.deliveryError).toBeUndefined();
    expect(await jobFailures(t)).toHaveLength(1);
  });
});
