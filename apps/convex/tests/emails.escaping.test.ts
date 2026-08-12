import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EmailId } from "@convex-dev/resend";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { readEmail } from "../convex/emailDelivery";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

/**
 * Every string these emails interpolate is attacker-reachable: a display name
 * is self-set through `users.update`, an event title is set by whoever created
 * the event, and the recipient of a calendar invite is chosen by the sender
 * (`guestEmails`). The message leaves on a domain with valid SPF and DKIM, so
 * markup that survives into the body is a phishing link the recipient's mail
 * client has every reason to trust.
 *
 * `icsEscapeText` already exists for the calendar attachment, which is the same
 * concern one context over.
 *
 * The seam is what Resend is handed. Asserting on the rendered `html` also
 * pins the negative: `subject` is plain text, and must NOT arrive escaped.
 */

const sendEmail = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      // Referenced lazily so the spy exists by the time it is called.
      send: (payload: unknown) => sendEmail(payload),
    };
  },
}));

/** Markup that becomes a live phishing link if it reaches the body unescaped. */
const INJECTION = `<a href="https://evil.example">Reset your password</a>`;

type SentEmail = { html: string; subject: string; to: string };

function lastEmail(): SentEmail {
  const calls = sendEmail.mock.calls;
  expect(calls.length, "an email must have been sent").toBeGreaterThan(0);
  return calls[calls.length - 1][0] as SentEmail;
}

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ data: { id: "email-1" }, error: null });
  process.env.AUTH_RESEND_KEY = "test-key";
  process.env.SITE_URL = "https://ripple.test";
});

/** The invite email as the component holds it, once the mutation has queued it. */
async function queuedInvite(
  t: ReturnType<typeof createTestContext>,
  inviteId: Id<"workspaceInvites">,
) {
  const email = await t.run(async (ctx) => {
    const invite = await ctx.db.get(inviteId);
    return await readEmail(ctx, invite!.deliveryEmailId as EmailId);
  });
  expect(email, "the invite must have queued an email").not.toBeNull();
  return email!;
}

describe("emails escape interpolated values", () => {
  /**
   * The invite's seam moved: it is no longer an action handed to Resend but an
   * email enqueued into `@convex-dev/resend` by the mutation itself, so the
   * rendered body is read back off the component record. The two assertions are
   * unchanged from when this covered `emails.sendWorkspaceInvite` — body
   * escaped, subject not — because the property under test never was about
   * which sender ran it.
   */
  it("the invite body does not render markup from the inviter's name", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t, "Acme");
    await t.run((ctx) => ctx.db.patch(userId, { name: INJECTION }));

    const inviteId = await asUser.mutation(api.workspaceInvites.create, {
      workspaceId,
      email: "guest@example.com",
    });

    const email = await queuedInvite(t, inviteId);
    expect(email.html).not.toContain("<a href=\"https://evil.example\"");
  });

  it("escapes the workspace name in the invite body but not the subject", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(
      t,
      `Sales & Marketing ${INJECTION}`,
    );

    const inviteId = await asUser.mutation(api.workspaceInvites.create, {
      workspaceId,
      email: "guest@example.com",
    });

    const email = await queuedInvite(t, inviteId);
    expect(email.html).not.toContain("<a href=\"https://evil.example\"");
    expect(email.html).toContain("Sales &amp; Marketing");
    // The subject is plain text — escaping it shows the recipient "&amp;".
    expect(email.subject).toContain("Sales & Marketing");
  });

  it("sendEventInvite does not render markup from the inviter name or event title", async () => {
    const t = createTestContext();

    await t.action(internal.emails.sendEventInvite, {
      eventId: "event-1",
      targetUrl: "https://ripple.test/share/abc",
      recipientEmail: "guest@example.com",
      inviterName: INJECTION,
      eventTitle: `Q3 planning ${INJECTION}`,
      startsAt: Date.UTC(2026, 7, 12, 9, 0),
      endsAt: Date.UTC(2026, 7, 12, 10, 0),
      timezone: "UTC",
      sequence: 0,
    });

    const email = lastEmail();
    expect(email.html).not.toContain("<a href=\"https://evil.example\"");
    // The genuine CTA must survive — escaping is not "strip every anchor".
    expect(email.html).toContain("https://ripple.test/share/abc");
  });

  it("sendEventReschedule does not render markup from the title or range label", async () => {
    const t = createTestContext();

    await t.action(internal.emails.sendEventReschedule, {
      eventId: "event-1",
      eventTitle: `Q3 planning ${INJECTION}`,
      recipientEmail: "guest@example.com",
      inviterName: INJECTION,
      newRangeLabel: `Mon, Aug 12 ${INJECTION}`,
      startsAt: Date.UTC(2026, 7, 12, 9, 0),
      endsAt: Date.UTC(2026, 7, 12, 10, 0),
      sequence: 1,
    });

    expect(lastEmail().html).not.toContain("<a href=\"https://evil.example\"");
  });

  it("sendEventCancellation does not render markup from the title or inviter name", async () => {
    const t = createTestContext();

    await t.action(internal.emails.sendEventCancellation, {
      eventId: "event-1",
      eventTitle: `Q3 planning ${INJECTION}`,
      recipientEmail: "guest@example.com",
      inviterName: INJECTION,
      startsAt: Date.UTC(2026, 7, 12, 9, 0),
      endsAt: Date.UTC(2026, 7, 12, 10, 0),
      sequence: 2,
    });

    expect(lastEmail().html).not.toContain("<a href=\"https://evil.example\"");
  });
});
