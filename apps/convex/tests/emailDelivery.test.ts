/**
 * Invite email delivery through `@convex-dev/resend` — the enqueue side and the
 * webhook sink.
 *
 * The first four tests began as the spike that decided the design, and they are
 * kept because each pins a property that is easy to regress into:
 *
 *  1. the component works under `convex-test` at all (which is what disproved
 *     the premise of the `process.env.VITEST` branches in the workpool wrappers);
 *  2. the enqueue is transactional with the invite row;
 *  3. the `testMode` footgun fails loudly rather than silently;
 *  4. a webhook event lands on the row a screen renders.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { EmailId } from "@convex-dev/resend";
import { api, internal } from "../convex/_generated/api";
import { readEmail } from "../convex/emailDelivery";
import { InviteStatus } from "@ripple/shared/enums/inviteStatus";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

/**
 * A Standard Webhooks / Svix signature, built the way Resend builds one:
 * HMAC-SHA256 over `${id}.${timestamp}.${body}` keyed with the raw bytes of the
 * secret after its `whsec_` prefix. Constructed here rather than mocked so the
 * route is exercised through real verification — the same code path that must
 * reject an unsigned caller.
 */
const WEBHOOK_SECRET = "whsec_dGVzdHNlY3JldHRlc3RzZWNyZXQxMjM0NTY3OA==";

function signWebhook(body: string): Record<string, string> {
  const id = "msg_test";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(WEBHOOK_SECRET.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  };
}

beforeEach(() => {
  vi.stubEnv("AUTH_RESEND_KEY", "re_test_key");
  vi.stubEnv("RESEND_TEST_MODE", "true");
  vi.stubEnv("SITE_URL", "https://ripple.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("invite email delivery (component wiring)", () => {
  it("enqueues from the mutation and stamps the invite row", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t, "Acme");

    const inviteId = await asUser.mutation(api.workspaceInvites.create, {
      workspaceId,
      email: "delivered@resend.dev",
    });

    const invite = await t.run(async (ctx) => await ctx.db.get(inviteId));
    expect(invite?.status).toBe(InviteStatus.PENDING);
    expect(invite?.deliveryEmailId).toEqual(expect.any(String));
    expect(invite?.deliveryStatus).toBe("waiting");
  });

  it("rolls the queued email back with the invite when the mutation throws", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t, "Acme");

    await asUser.mutation(api.workspaceInvites.create, {
      workspaceId,
      email: "delivered@resend.dev",
    });

    // A second invite to the same address is rejected — after the point where
    // a scheduled-action design would already have queued the mail.
    await expect(
      asUser.mutation(api.workspaceInvites.create, {
        workspaceId,
        email: "delivered@resend.dev",
      }),
    ).rejects.toThrow();

    const invites = await t.run(
      async (ctx) => await ctx.db.query("workspaceInvites").collect(),
    );
    expect(invites).toHaveLength(1);
  });

  /**
   * A request that fails signature verification can never succeed on a retry,
   * so answering 500 tells Resend to keep trying something hopeless and files
   * every stray probe as a server error. 400 is the honest answer.
   *
   * Deliberately narrow: only a verification failure is downgraded. Anything
   * else — an unset secret, a database failure mid-handler — stays a 500,
   * because those *are* server errors and a retry is exactly what we want.
   */
  it("answers 400 to a delivery whose signature does not verify", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_dGVzdHNlY3JldHRlc3RzZWNyZXQ=");
    const t = createTestContext();

    const response = await t.fetch("/resend-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "email.delivered" }),
    });

    expect(response.status).toBe(400);
  });

  /**
   * The end of the wire the component cannot be relied on for. Its
   * `onEmailEvent` callback is dispatched only when its `lastOptions` row
   * exists, and only the batch path writes that row — so on a deployment whose
   * mail has all been manual (calendar), a verified delivery event reaches the
   * component, matches nothing, and is dropped. The route therefore resolves
   * the event itself, by Resend's message id, after the component has accepted
   * the request and thereby vouched for its signature.
   */
  it("records a verified delivery even when the component's callback never fires", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", WEBHOOK_SECRET);
    const t = createTestContext();

    const inviteeId = await t.run(async (ctx) => {
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "Acme",
        ownerId: await ctx.db.insert("users", { name: "Owner" }),
      });
      const eventId = await ctx.db.insert("calendarEvents", {
        workspaceId,
        title: "Q3 planning",
        startsAt: Date.UTC(2026, 7, 20, 9, 0),
        endsAt: Date.UTC(2026, 7, 20, 10, 0),
        timezone: "UTC",
        createdBy: await ctx.db.insert("users", { name: "Organizer" }),
      });
      return await ctx.db.insert("calendarEventInvitees", {
        eventId,
        workspaceId,
        guestEmail: "guest@example.com",
        status: "pending",
        deliveryResendId: "resend-live-1",
        deliveryStatus: "sent",
      });
    });

    const body = JSON.stringify({
      type: "email.delivered",
      created_at: "2026-08-12T00:00:00.000Z",
      data: {
        created_at: "2026-08-12T00:00:00.000Z",
        email_id: "resend-live-1",
        from: "noreply@ripple.test",
        to: ["guest@example.com"],
        subject: "Invitation: Q3 planning",
      },
    });

    const response = await t.fetch("/resend-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...signWebhook(body) },
      body,
    });

    expect(response.status).toBeLessThan(300);
    const invitee = await t.run(async (ctx) => await ctx.db.get(inviteeId));
    expect(invitee?.deliveryStatus).toBe("delivered");
  });

  /** The other half of that rule: a misconfigured deployment is not a 400. */
  it("does not downgrade a missing webhook secret to a client error", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    const t = createTestContext();

    const outcome = await t
      .fetch("/resend-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "email.delivered" }),
      })
      .then((response) => response.status)
      .catch(() => "threw" as const);

    expect(outcome).not.toBe(400);
  });

  /**
   * The component keeps every email it has handled — including the rendered
   * `html` — and schedules no cleanup of its own; it only exposes the two
   * cleanup mutations. Nothing calls them unless we do, so retention is a
   * property of our cron, not of the component.
   *
   * Both thresholds are passed explicitly here so the test states a policy
   * rather than inheriting one: with a zero window every record is past it.
   */
  it("cleans up component email records past the retention window", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t, "Acme");

    const inviteId = await asUser.mutation(api.workspaceInvites.create, {
      workspaceId,
      email: "delivered@resend.dev",
    });
    const emailId = await t.run(
      async (ctx) => (await ctx.db.get(inviteId))!.deliveryEmailId!,
    );

    await t.mutation(internal.emailMaintenance.pruneEmailRecords, {
      finalizedOlderThanMs: 0,
      abandonedOlderThanMs: 0,
    });

    const email = await t.run(
      async (ctx) => await readEmail(ctx, emailId as EmailId),
    );
    expect(email).toBeNull();
  });

  it("leaves a record inside the retention window alone", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t, "Acme");

    const inviteId = await asUser.mutation(api.workspaceInvites.create, {
      workspaceId,
      email: "delivered@resend.dev",
    });
    const emailId = await t.run(
      async (ctx) => (await ctx.db.get(inviteId))!.deliveryEmailId!,
    );

    await t.mutation(internal.emailMaintenance.pruneEmailRecords, {});

    const email = await t.run(
      async (ctx) => await readEmail(ctx, emailId as EmailId),
    );
    expect(email).not.toBeNull();
  });

  /**
   * SPIKE FINDING, and the sharpest consequence of enqueueing inside the
   * mutation: with `testMode: true` the component *rejects* any address that
   * isn't `{delivered,bounced,complained}@resend.dev` — and since the enqueue
   * now shares the invite's transaction, that rejection takes the invite with
   * it. A dev deployment therefore cannot invite a real colleague at all; it
   * does not merely skip the mail. Pinned as a test because the alternative is
   * discovering it in dev and "fixing" it by moving the enqueue back out of the
   * transaction, which is the whole thing we came here to remove.
   */
  it("rejects a real address under testMode, rolling back the invite", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t, "Acme");

    await expect(
      asUser.mutation(api.workspaceInvites.create, {
        workspaceId,
        email: "colleague@example.com",
      }),
    ).rejects.toThrow(/not a valid resend test address/);

    const invites = await t.run(
      async (ctx) => await ctx.db.query("workspaceInvites").collect(),
    );
    expect(invites).toHaveLength(0);
  });

  it("refuses to send when RESEND_TEST_MODE is unset", async () => {
    vi.stubEnv("RESEND_TEST_MODE", "");
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t, "Acme");

    await expect(
      asUser.mutation(api.workspaceInvites.create, {
        workspaceId,
        email: "delivered@resend.dev",
      }),
    ).rejects.toThrow(/RESEND_TEST_MODE/);

    // And the invite did not commit either — the guard fails the whole
    // transaction rather than leaving a row nobody was told about.
    const invites = await t.run(
      async (ctx) => await ctx.db.query("workspaceInvites").collect(),
    );
    expect(invites).toHaveLength(0);
  });

  /**
   * `email.failed` is Resend's hard send failure — distinct from a bounce,
   * which happens after the message was accepted. Both leave the invite stuck
   * at `pending`, so both have to reach the row; only the bounce did.
   */
  it("records a send failure from the email-event sink onto the invite row", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t, "Acme");

    const inviteId = await asUser.mutation(api.workspaceInvites.create, {
      workspaceId,
      email: "delivered@resend.dev",
    });
    const emailId = await t.run(
      async (ctx) => (await ctx.db.get(inviteId))!.deliveryEmailId!,
    );

    await t.mutation(internal.emailEvents.recordEmailEvent, {
      id: emailId as never,
      event: {
        type: "email.failed",
        created_at: "2026-08-12T00:00:00.000Z",
        data: {
          created_at: "2026-08-12T00:00:00.000Z",
          email_id: "resend-id",
          from: "noreply@ripple.test",
          to: ["delivered@resend.dev"],
          subject: "Invitation",
          failed: { reason: "Domain is not verified." },
        },
      } as never,
    });

    const invite = await t.run(async (ctx) => await ctx.db.get(inviteId));
    expect(invite?.deliveryStatus).toBe("failed");
    expect(invite?.deliveryError).toBe("Domain is not verified.");
  });

  it("records a bounce from the email-event sink onto the invite row", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t, "Acme");

    const inviteId = await asUser.mutation(api.workspaceInvites.create, {
      workspaceId,
      email: "delivered@resend.dev",
    });
    const emailId = await t.run(
      async (ctx) => (await ctx.db.get(inviteId))!.deliveryEmailId!,
    );

    await t.mutation(internal.emailEvents.recordEmailEvent, {
      id: emailId as never,
      event: {
        type: "email.bounced",
        created_at: "2026-08-12T00:00:00.000Z",
        data: {
          created_at: "2026-08-12T00:00:00.000Z",
          email_id: "resend-id",
          from: "noreply@ripple.test",
          to: ["invitee@example.com"],
          subject: "Invitation",
          bounce: {
            message: "The recipient's mailbox does not exist.",
            subType: "General",
            type: "Permanent",
          },
        },
      } as never,
    });

    const invite = await t.run(async (ctx) => await ctx.db.get(inviteId));
    expect(invite?.deliveryStatus).toBe("bounced");
    expect(invite?.deliveryError).toBe(
      "The recipient's mailbox does not exist.",
    );
  });
});
