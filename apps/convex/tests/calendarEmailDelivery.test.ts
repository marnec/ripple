/**
 * Delivery tracking for calendar mail — the half of T6's email work that cannot
 * use the component's batch endpoint, because every one of these messages
 * carries the ICS attachment whose ORGANIZER is the RSVP ingestion path.
 *
 * The webhook sink is shared with workspace invites: one Resend event has to
 * find whichever row queued it, and a guest invitee is exactly the population
 * where a typo'd address concentrates.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { isNonRetryableError } from "@convex-dev/workpool";
import { EMAIL_RSVP_DOMAIN } from "@ripple/shared/constants";
import { internal } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

/** Stands in for Resend's HTTP client; each test decides what the send returns. */
const sendEmail = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      // Both arguments: Resend takes the message as the first and per-request
      // options (the idempotency key) as the second.
      send: (payload: unknown, options?: unknown) => sendEmail(payload, options),
    };
  },
}));

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ data: { id: "resend-1" }, error: null });
  vi.stubEnv("AUTH_RESEND_KEY", "re_test_key");
  vi.stubEnv("RESEND_TEST_MODE", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function seedGuestInvitee(
  t: ReturnType<typeof createTestContext>,
  deliveryEmailId: string | undefined,
) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t, "Acme");
  return await t.run(async (ctx) => {
    const eventId = await ctx.db.insert("calendarEvents", {
      workspaceId,
      title: "Q3 planning",
      startsAt: Date.UTC(2026, 7, 20, 9, 0),
      endsAt: Date.UTC(2026, 7, 20, 10, 0),
      timezone: "UTC",
      createdBy: userId,
    });
    return await ctx.db.insert("calendarEventInvitees", {
      eventId,
      workspaceId,
      guestEmail: "typo@exmaple.com",
      status: "pending",
      deliveryEmailId,
    });
  });
}

/** The args every `sendEventInvite` test varies only slightly. */
function inviteArgs(overrides: Record<string, unknown>) {
  return {
    eventId: "event-1",
    targetUrl: "https://ripple.test/share/abc",
    recipientEmail: "guest@example.com",
    inviterName: "Alice",
    eventTitle: "Q3 planning",
    startsAt: Date.UTC(2026, 7, 20, 9, 0),
    endsAt: Date.UTC(2026, 7, 20, 10, 0),
    timezone: "UTC",
    sequence: 0,
    ...overrides,
  };
}

describe("calendar send attempts", () => {
  it("records the component's email id on the invitee row after a send", async () => {
    const t = createTestContext();
    const inviteeId = await seedGuestInvitee(t, undefined);

    await t.action(
      internal.emails.sendEventInvite,
      inviteArgs({ inviteeId }) as never,
    );

    const invitee = await t.run(async (ctx) => await ctx.db.get(inviteeId));
    expect(invitee?.deliveryEmailId).toEqual(expect.any(String));
    expect(invitee?.deliveryStatus).toBe("sent");
  });

  /**
   * The idempotency key has to change per attempt, or Resend returns the same
   * message id for two component records and the webhook — which resolves by
   * `resendId` and takes the first match — lands status on a record nobody
   * reads. The component's per-attempt `emailId` is the key, so this is
   * per-attempt by construction rather than by discipline.
   */
  it("sends with the component's email id as the idempotency key", async () => {
    const t = createTestContext();
    const inviteeId = await seedGuestInvitee(t, undefined);

    await t.action(
      internal.emails.sendEventInvite,
      inviteArgs({ inviteeId }) as never,
    );

    const invitee = await t.run(async (ctx) => await ctx.db.get(inviteeId));
    expect(sendEmail).toHaveBeenCalledWith(expect.any(Object), {
      idempotencyKey: invitee?.deliveryEmailId,
    });
  });

  it("throws a retryable error on a 429 so the pool backs off", async () => {
    const t = createTestContext();
    const inviteeId = await seedGuestInvitee(t, undefined);
    sendEmail.mockResolvedValue({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Too many requests" },
    });

    const failure = await t
      .action(internal.emails.sendEventInvite, inviteArgs({ inviteeId }) as never)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(isNonRetryableError(failure as Error)).toBe(false);
    // A transient failure is not an outcome — the row must not read as failed
    // while the pool is still trying.
    const invitee = await t.run(async (ctx) => await ctx.db.get(inviteeId));
    expect(invitee?.deliveryStatus).not.toBe("failed");
  });

  it("stops retrying and records the reason on a rejected payload", async () => {
    const t = createTestContext();
    const inviteeId = await seedGuestInvitee(t, undefined);
    sendEmail.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Invalid `to` field." },
    });

    const failure = await t
      .action(internal.emails.sendEventInvite, inviteArgs({ inviteeId }) as never)
      .catch((error: unknown) => error);

    expect(isNonRetryableError(failure as Error)).toBe(true);
    const invitee = await t.run(async (ctx) => await ctx.db.get(inviteeId));
    expect(invitee?.deliveryStatus).toBe("failed");
    expect(invitee?.deliveryError).toContain("Invalid `to` field.");
  });

  /**
   * Quota is spent, not wrong: five attempts inside a few minutes cannot
   * outlast a window that resets in hours, so retrying is pointless — but the
   * organizer needs to read "we are out of quota", not "that address is bad".
   */
  it("stops retrying on quota exhaustion and says so", async () => {
    const t = createTestContext();
    const inviteeId = await seedGuestInvitee(t, undefined);
    sendEmail.mockResolvedValue({
      data: null,
      error: { name: "daily_quota_exceeded", message: "Daily quota reached" },
    });

    const failure = await t
      .action(internal.emails.sendEventInvite, inviteArgs({ inviteeId }) as never)
      .catch((error: unknown) => error);

    expect(isNonRetryableError(failure as Error)).toBe(true);
    const invitee = await t.run(async (ctx) => await ctx.db.get(inviteeId));
    expect(invitee?.deliveryStatus).toBe("failed");
    expect(invitee?.deliveryError).toContain("quota");
  });
});

/**
 * Characterization, not TDD — these pass on arrival, and that is the point.
 * Moving calendar mail onto the component's tracking is exactly the change that
 * could quietly drop the attachment (the component's own `sendEmail` cannot
 * carry one at all), and nothing anywhere covered the ICS before. The RSVP
 * ingestion path in `packages/rsvp-worker` keys on these fields: mail clients
 * mail their METHOD:REPLY to the ORGANIZER address, matched back by UID.
 */
describe("the ICS attachment survives the component", () => {
  it("attaches a text/calendar part carrying the RSVP organizer and UID", async () => {
    const t = createTestContext();
    const inviteeId = await seedGuestInvitee(t, undefined);

    await t.action(
      internal.emails.sendEventInvite,
      inviteArgs({ inviteeId }) as never,
    );

    const [payload] = sendEmail.mock.calls[0] as [
      { attachments: Array<{ filename: string; contentType: string; content: Buffer }> },
    ];
    const attachment = payload.attachments[0];

    expect(attachment.filename).toBe("invite.ics");
    expect(attachment.contentType).toBe(
      "text/calendar; method=REQUEST; charset=utf-8; name=invite.ics",
    );

    const ics = attachment.content.toString("utf-8");
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain(`UID:event-1@${EMAIL_RSVP_DOMAIN}`);
    expect(ics).toContain(`ORGANIZER;CN=Alice:mailto:rsvp@${EMAIL_RSVP_DOMAIN}`);
    expect(ics).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION");
    // RFC 5545 mandates CRLF; Outlook enforces it.
    expect(ics).toContain("\r\n");
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it("marks the cancellation attachment as METHOD:CANCEL", async () => {
    const t = createTestContext();
    const inviteeId = await seedGuestInvitee(t, undefined);

    await t.action(internal.emails.sendEventCancellation, {
      eventId: "event-1",
      eventTitle: "Q3 planning",
      recipientEmail: "guest@example.com",
      inviterName: "Alice",
      startsAt: Date.UTC(2026, 7, 20, 9, 0),
      endsAt: Date.UTC(2026, 7, 20, 10, 0),
      sequence: 1,
      inviteeId,
    } as never);

    const [payload] = sendEmail.mock.calls[0] as [
      { attachments: Array<{ contentType: string; content: Buffer }> },
    ];
    expect(payload.attachments[0].contentType).toContain("method=CANCEL");
    expect(payload.attachments[0].content.toString("utf-8")).toContain(
      "STATUS:CANCELLED",
    );
  });
});

/**
 * The component only dispatches `onEmailEvent` if its `lastOptions` row exists,
 * and that row is written exclusively by the batch path (`sendEmail`) — its own
 * source says so: "lastOptions may not exist if the user only uses
 * sendEmailManually". Calendar mail *is* the manual path, so on a deployment
 * that has never sent a workspace invite its delivery events were verified,
 * matched, and then dropped with nothing logged. Observed in dev: a real
 * calendar invitation arrived in an inbox while its row sat at `sent` forever.
 *
 * So delivery no longer depends on that callback being wired. We know Resend's
 * own message id at send time; the row keeps it, and the webhook route resolves
 * events by it directly.
 */
describe("delivery events resolved by Resend message id", () => {
  it("applies a delivery event to the row holding that message id", async () => {
    const t = createTestContext();
    const inviteeId = await seedGuestInvitee(t, "email-x");
    await t.run(async (ctx) => {
      await ctx.db.patch(inviteeId, { deliveryResendId: "resend-abc" });
    });

    await t.mutation(internal.emailEvents.recordEventByResendId, {
      resendId: "resend-abc",
      event: {
        type: "email.delivered",
        created_at: "2026-08-12T00:00:00.000Z",
        data: {
          created_at: "2026-08-12T00:00:00.000Z",
          email_id: "resend-abc",
          from: "noreply@ripple.test",
          to: ["guest@example.com"],
          subject: "Invitation",
        },
      } as never,
    });

    const invitee = await t.run(async (ctx) => await ctx.db.get(inviteeId));
    expect(invitee?.deliveryStatus).toBe("delivered");
  });

  it("ignores an event for a message id we never sent", async () => {
    const t = createTestContext();
    const inviteeId = await seedGuestInvitee(t, "email-y");

    await t.mutation(internal.emailEvents.recordEventByResendId, {
      resendId: "resend-unknown",
      event: {
        type: "email.bounced",
        created_at: "2026-08-12T00:00:00.000Z",
        data: {
          created_at: "2026-08-12T00:00:00.000Z",
          email_id: "resend-unknown",
          from: "noreply@ripple.test",
          to: ["guest@example.com"],
          subject: "Invitation",
          bounce: { message: "nope", subType: "General", type: "Permanent" },
        },
      } as never,
    });

    const invitee = await t.run(async (ctx) => await ctx.db.get(inviteeId));
    expect(invitee?.deliveryStatus).toBeUndefined();
  });

  it("stamps the Resend message id on the row when the send succeeds", async () => {
    const t = createTestContext();
    const inviteeId = await seedGuestInvitee(t, undefined);
    sendEmail.mockResolvedValue({ data: { id: "resend-fresh" }, error: null });

    await t.action(
      internal.emails.sendEventInvite,
      inviteArgs({ inviteeId }) as never,
    );

    const invitee = await t.run(async (ctx) => await ctx.db.get(inviteeId));
    expect(invitee?.deliveryResendId).toBe("resend-fresh");
  });
});

describe("calendar email delivery", () => {
  it("records a bounce against the guest invitee row", async () => {
    const t = createTestContext();
    const inviteeId = await seedGuestInvitee(t, "email-guest-1");

    await t.mutation(internal.emailEvents.recordEmailEvent, {
      id: "email-guest-1" as never,
      event: {
        type: "email.bounced",
        created_at: "2026-08-12T00:00:00.000Z",
        data: {
          created_at: "2026-08-12T00:00:00.000Z",
          email_id: "resend-id",
          from: "noreply@ripple.test",
          to: ["typo@exmaple.com"],
          subject: "Invitation",
          bounce: {
            message: "The recipient's mailbox does not exist.",
            subType: "General",
            type: "Permanent",
          },
        },
      } as never,
    });

    const invitee = await t.run(async (ctx) => await ctx.db.get(inviteeId));
    expect(invitee?.deliveryStatus).toBe("bounced");
    expect(invitee?.deliveryError).toBe(
      "The recipient's mailbox does not exist.",
    );
    // The RSVP state is a different axis and must not move: a bounced invite is
    // still awaiting an answer, it just will not get one by waiting.
    expect(invitee?.status).toBe("pending");
  });

  it("records delivery against the guest invitee row", async () => {
    const t = createTestContext();
    const inviteeId = await seedGuestInvitee(t, "email-guest-2");

    await t.mutation(internal.emailEvents.recordEmailEvent, {
      id: "email-guest-2" as never,
      event: {
        type: "email.delivered",
        created_at: "2026-08-12T00:00:00.000Z",
        data: {
          created_at: "2026-08-12T00:00:00.000Z",
          email_id: "resend-id",
          from: "noreply@ripple.test",
          to: ["typo@exmaple.com"],
          subject: "Invitation",
        },
      } as never,
    });

    const invitee = await t.run(async (ctx) => await ctx.db.get(inviteeId));
    expect(invitee?.deliveryStatus).toBe("delivered");
  });
});
