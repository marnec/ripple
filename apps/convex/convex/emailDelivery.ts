/**
 * The `@convex-dev/resend` component wiring — the durable side of outbound
 * email. SPIKE: only the workspace-invite path routes through here so far; the
 * calendar sends still go out through `emails.ts`'s own Resend client because
 * the component's batch endpoint cannot carry the ICS attachment.
 *
 * Why the component rather than a hand-rolled pool: `sendEmail` is callable
 * from a *mutation*, so the enqueue commits with the row that caused it. The
 * old shape — `ctx.scheduler.runAfter(0, internal.emails.*)` — schedules an
 * action, and scheduled actions run **at most once** with no retry, so a Resend
 * 429 meant the invite was simply never sent and the row sat at `pending`,
 * indistinguishable from "hasn't replied". Internally the component is a
 * workpool + rate-limiter with Resend idempotency keys, which is the same
 * design we would otherwise have written by hand.
 */

import {
  Resend,
  type EmailEvent,
  type EmailId,
  type ResendOptions,
} from "@convex-dev/resend";
import { NonRetryableError } from "@convex-dev/workpool";
import { APP_NAME, EMAIL_FROM_DOMAIN } from "@ripple/shared/constants";
import { v } from "convex/values";
import { classifyResendError } from "./utils/emailErrors";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { emailDeliveryStatus } from "./schema";
import {
  renderWorkspaceInviteEmail,
  workspaceInviteSubject,
} from "./emailTemplates";

/**
 * `testMode` defaults to `true` in the component and silently restricts
 * delivery to Resend's own test addresses — so a deployment that forgets the
 * variable does not error, it just stops mailing anyone. Both directions of
 * that mistake are bad (a dev deployment mailing real people is the reason the
 * library defaults the way it does), so neither gets to be the default here:
 * the value is read explicitly and an unset//misspelled variable throws on the
 * send path, where it is visible, rather than at import time, which would take
 * down every function in the module.
 */
function resolveTestMode(): boolean {
  const raw = process.env.RESEND_TEST_MODE;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(
    'RESEND_TEST_MODE must be set to "true" or "false" on this deployment ' +
      `(got ${raw === undefined ? "unset" : JSON.stringify(raw)}). ` +
      'Production sets "false"; dev deployments set "true" so mail only ' +
      "reaches Resend's test addresses.",
  );
}

/**
 * Built per call rather than at module scope: `resolveTestMode` throws, and a
 * throw during module evaluation fails every function in the file, not just the
 * one that needed the config.
 *
 * `apiKey` is passed explicitly because the component reads `RESEND_API_KEY` by
 * default while this deployment holds the same secret in `AUTH_RESEND_KEY`,
 * shared with Convex Auth's own Resend OTP provider. One secret, two readers.
 */
function emailClient(): Resend {
  return new Resend(components.resend, {
    apiKey: process.env.AUTH_RESEND_KEY,
    testMode: resolveTestMode(),
    // Cast because static codegen (`convex.json`'s `staticApi`) erases the
    // branded `EmailId` on generated function references down to `string`, so
    // the reference no longer structurally matches `ResendOptions`. The runtime
    // value is identical; only the brand is lost in the generated declaration.
    onEmailEvent: internal.emailEvents
      .recordEmailEvent as unknown as ResendOptions["onEmailEvent"],
  });
}

/**
 * Enqueue the workspace-invite email and stamp the invite row with the
 * component's `EmailId`, which is the only key the webhook can match on later
 * (`emailEvents.recordEmailEvent`).
 *
 * Called from the mutation that wrote the invite, so the two commit together:
 * no invite without a queued mail, and no queued mail without an invite. The
 * previous `ctx.scheduler.runAfter(0, internal.emails.sendWorkspaceInvite)`
 * gave the first half of that guarantee and not the second — the schedule was
 * atomic, the *send* was a separate at-most-once action.
 */
export async function sendWorkspaceInviteEmail(
  ctx: MutationCtx,
  opts: {
    inviteId: Id<"workspaceInvites">;
    workspaceName: string;
    inviterName: string;
    recipientEmail: string;
  },
): Promise<EmailId> {
  const emailId = await emailClient().sendEmail(ctx, {
    from: `${APP_NAME} <noreply@${EMAIL_FROM_DOMAIN}>`,
    to: opts.recipientEmail,
    subject: workspaceInviteSubject(opts.workspaceName),
    html: renderWorkspaceInviteEmail({
      inviterName: opts.inviterName,
      workspaceName: opts.workspaceName,
      url: `${process.env.SITE_URL}/invite/${opts.inviteId}`,
    }),
  });

  await ctx.db.patch(opts.inviteId, {
    deliveryEmailId: emailId,
    deliveryStatus: "waiting",
    deliveryError: undefined,
  });

  return emailId;
}

/**
 * Track one manual send through the component and turn its outcome into the
 * workpool's retry contract.
 *
 * `sendEmailManually` is the component's escape hatch for anything its batch
 * endpoint cannot express — here, the ICS attachment. It records the attempt
 * and rethrows on failure, but it does **not** queue, batch or retry: that is
 * ours, which is why the caller runs inside `emailPool`.
 *
 * The callback receives the component's per-attempt `emailId`, and that id is
 * doing three jobs: it stamps the invitee row before the send (so an early
 * webhook still matches), it is the Resend idempotency key (per-attempt by
 * construction — a *stable* key would make Resend return one message id for two
 * component records, and the webhook resolves by `resendId` with `.first()`),
 * and it is what a later delivery event resolves back to.
 *
 * Throwing is the retry signal, so the class decides which throw:
 *  - `retryable` → a plain error; the pool backs off. The row is left alone —
 *    an attempt still in flight must not read as a failure.
 *  - `permanent` / `quota` → `NonRetryableError`; the pool stops and the row
 *    records why.
 */
export async function sendTrackedEmail(
  ctx: ActionCtx,
  opts: {
    inviteeId?: Id<"calendarEventInvitees">;
    to: string;
    subject: string;
    send: (idempotencyKey: string) => Promise<SendOutcome>;
  },
): Promise<void> {
  const from = `${APP_NAME} <noreply@${EMAIL_FROM_DOMAIN}>`;
  // A holder rather than a `let`: the assignment happens inside the callback,
  // which TypeScript's control-flow analysis does not follow, so a plain
  // variable narrows to `never` by the time the catch reads it.
  const attempt: { outcome: SendOutcome | null } = { outcome: null };

  try {
    await emailClient().sendEmailManually(
      ctx,
      { from, to: opts.to, subject: opts.subject },
      async (emailId) => {
        if (opts.inviteeId) {
          await ctx.runMutation(internal.emailDelivery.recordCalendarAttempt, {
            inviteeId: opts.inviteeId,
            emailId,
            status: "waiting",
          });
        }
        attempt.outcome = await opts.send(emailId);
        if (attempt.outcome.kind === "error") {
          // Thrown so the component records this attempt as failed too; the
          // classification happens outside, where the retry decision lives.
          throw new Error(attempt.outcome.message);
        }
        return attempt.outcome.resendId;
      },
    );
  } catch (error) {
    const failure = attempt.outcome;

    // The throw came from the component or the network rather than from a
    // Resend rejection we can read, so there is nothing to classify — treat it
    // as transient and let the pool decide by counting attempts.
    if (failure === null || failure.kind !== "error") throw error;

    const failureClass = classifyResendError(failure.code, failure.status);
    if (failureClass === "retryable") throw error;

    const reason =
      failureClass === "quota"
        ? `Email quota exhausted: ${failure.message}`
        : failure.message;

    if (opts.inviteeId) {
      await ctx.runMutation(internal.emailDelivery.recordCalendarAttempt, {
        inviteeId: opts.inviteeId,
        status: "failed",
        error: reason,
      });
    }
    throw new NonRetryableError(reason);
  }

  if (opts.inviteeId) {
    await ctx.runMutation(internal.emailDelivery.recordCalendarAttempt, {
      inviteeId: opts.inviteeId,
      // Recorded now rather than inside the callback because this is where the
      // send is known to have succeeded — and it is what lets the webhook route
      // find this row without the component's callback being registered.
      resendId:
        attempt.outcome?.kind === "sent" ? attempt.outcome.resendId : undefined,
      status: "sent",
    });
  }
}

/** What one Resend call came back with, as the tracker needs to see it. */
export type SendOutcome =
  | { kind: "sent"; resendId: string }
  | {
      kind: "error";
      /** Resend's error code, e.g. `rate_limit_exceeded`. */
      code: string | undefined;
      status: number | undefined;
      message: string;
    };

/**
 * The component's own record for a queued/sent email — `to`, `subject`, `html`
 * and the live delivery `status`. The component is the source of truth; the
 * columns denormalized onto `workspaceInvites` are only what a list view needs
 * without a per-row component read.
 */
export async function readEmail(
  ctx: Parameters<Resend["get"]>[0],
  emailId: EmailId,
): ReturnType<Resend["get"]> {
  return await emailClient().get(ctx, emailId);
}

/**
 * Send-side bookkeeping for calendar mail, which cannot use `sendEmail` (the
 * component's batch endpoint carries no attachments, and every calendar message
 * carries the ICS whose ORGANIZER is the RSVP path). The action stamps the row
 * before it sends, so a delivery webhook that arrives while the send is still
 * returning still finds its row.
 *
 * `deliveryEmailId` is overwritten on every attempt: `sendEmailManually`
 * creates one component record per attempt, and the row tracks the newest.
 */
export const recordCalendarAttempt = internalMutation({
  args: {
    inviteeId: v.id("calendarEventInvitees"),
    emailId: v.optional(v.string()),
    /** Resend's own message id — how the webhook route finds this row. */
    resendId: v.optional(v.string()),
    status: emailDeliveryStatus,
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // The invitee may have been removed between queueing and the attempt —
    // the organizer edited the guest list while the pool was backing off.
    if ((await ctx.db.get(args.inviteeId)) === null) return null;
    await ctx.db.patch(args.inviteeId, {
      ...(args.emailId === undefined ? {} : { deliveryEmailId: args.emailId }),
      ...(args.resendId === undefined ? {} : { deliveryResendId: args.resendId }),
      deliveryStatus: args.status,
      deliveryError: args.error,
    });
    return null;
  },
});

/**
 * The webhook route in `http.ts` hands the raw request straight through — the
 * component verifies the Svix signature off the body itself, so nothing here
 * may read it first.
 *
 * The one thing added on top is the status code for a request that fails
 * verification. The component throws, which would surface as a 500, and a 500
 * tells Resend "server error, retry" for a request that can never succeed —
 * so a stray or forged delivery would be retried on a schedule and filed as a
 * server fault every time.
 *
 * Matched on the error's `name` rather than an `instanceof`: the thrower is
 * `standardwebhooks`, reached only as a transitive dependency of the component,
 * and importing it directly to get the class would pin us to a package we do
 * not otherwise use. Anything unrecognised keeps its 500 — an unset secret or a
 * database failure mid-handler genuinely is a server error, and there a retry
 * is what we want.
 */
export async function handleResendWebhook(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  // Cloned before the component reads the body to verify it — a Request body
  // can only be consumed once, and the component must be the one to consume it.
  const copy = request.clone();

  let response: Response;
  try {
    response = await emailClient().handleResendEventWebhook(ctx, request);
  } catch (error) {
    if (error instanceof Error && error.name === "WebhookVerificationError") {
      return new Response("Invalid signature", { status: 400 });
    }
    throw error;
  }

  // Only past this point is the payload known to be genuinely from Resend: the
  // component verified the signature and answered 2xx.
  if (response.ok) await applyDeliveryToOurRows(ctx, copy);
  return response;
}

/**
 * Apply a verified event to our own rows, resolving it by Resend's message id
 * rather than the component's.
 *
 * This exists because the component's `onEmailEvent` callback fires only when
 * its `lastOptions` row is present, and that row is written exclusively by the
 * batch path (`sendEmail`). Calendar mail is manual, so on a deployment that
 * has never sent a workspace invite the callback is simply absent and every
 * delivery event for calendar mail is discarded in silence. Rather than depend
 * on one sender having run before another, the route resolves what it can
 * itself; when the callback *is* registered both paths apply the same patch,
 * which is a function of the event alone and therefore safely idempotent.
 *
 * Nothing here may fail the request. The signature already verified, so a 500
 * would make Resend retry a delivery that has been accepted — and the event
 * shapes are the provider's, not ours.
 */
async function applyDeliveryToOurRows(
  ctx: ActionCtx,
  request: Request,
): Promise<void> {
  try {
    const event: unknown = await request.json();
    if (!isRecord(event) || typeof event.type !== "string") return;
    // Only the states anything renders. `opened` / `clicked` / `complained` are
    // the component's business, not ours.
    if (!TRACKED_EVENT_TYPES.has(event.type)) return;

    const data = event.data;
    if (!isRecord(data) || typeof data.email_id !== "string") return;

    await ctx.runMutation(internal.emailEvents.recordEventByResendId, {
      resendId: data.email_id,
      // Cast because this shape is the provider's, checked at the mutation's
      // own validator rather than here; a mismatch throws inside the try above
      // and the delivery is still acknowledged.
      event: event as unknown as EmailEvent,
    });
  } catch {
    // A shape we cannot parse is not a reason to reject a verified delivery.
    return;
  }
}

const TRACKED_EVENT_TYPES = new Set([
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.failed",
  "email.delivery_delayed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
