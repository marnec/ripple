/**
 * The `onEmailEvent` sink for `@convex-dev/resend`: Resend's webhook lands on
 * the component, the component updates its own record and then calls this with
 * `{ id, event }`. Everything here is denormalization — the component's record
 * stays the source of truth (`resend.status()`), this just puts the answer on
 * the row a screen already renders, so the invite list does not need a
 * component read per row.
 */

import { v } from "convex/values";
import { vOnEmailEventArgs, type EmailEvent, type Status } from "@convex-dev/resend";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";

export const recordEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  returns: v.null(),
  handler: async (ctx, { id, event }) => {
    const target = await findRowForEmail(ctx, id);

    // Not every tracked email belongs to a row we keep (and the component holds
    // finalized records for a while after the row that queued them is gone), so
    // an unmatched event is expected, not an error.
    if (!target) return null;

    const patch = deliveryPatch(event);
    if (!patch) return null;
    await ctx.db.patch(target, patch);
    return null;
  },
});

/**
 * The same denormalization, resolved by **Resend's** message id instead of the
 * component's.
 *
 * Why a second door into the same patch: the component dispatches
 * `onEmailEvent` only when its `lastOptions` row exists, and that row is
 * written exclusively by the batch path (`sendEmail`). Calendar mail sends
 * manually, so on a deployment where no workspace invite has ever gone out its
 * delivery events are verified, matched to a component record, and then
 * dropped — nothing logged, nothing retried. This was observed in dev: a
 * calendar invitation landed in a real inbox while its row stayed at `sent`.
 *
 * The route calls this after the component has accepted (and therefore
 * verified) the request, so an unsigned caller never reaches it. Applying the
 * same patch twice — once here, once via the callback when it is registered —
 * is harmless: the patch is a function of the event, not of the current row.
 */
export const recordEventByResendId = internalMutation({
  args: { resendId: v.string(), event: vOnEmailEventArgs.fields.event },
  returns: v.null(),
  handler: async (ctx, { resendId, event }) => {
    const invitee = await ctx.db
      .query("calendarEventInvitees")
      .withIndex("by_delivery_resend", (q) => q.eq("deliveryResendId", resendId))
      .unique();
    if (!invitee) return null;

    const patch = deliveryPatch(event);
    if (!patch) return null;
    await ctx.db.patch(invitee._id, patch);
    return null;
  },
});

/**
 * The two tables that queue email. Both carry the same three delivery columns
 * and both index `deliveryEmailId`, so the lookup is one shape twice rather
 * than a branch per table — which is what keeps adding a third sender (a
 * password reset, say) to a single line here.
 *
 * `.unique()` is safe *on this side*: the id comes from the component and is
 * stamped onto exactly one row. Calendar mail creates one component record per
 * send attempt, but each attempt overwrites `deliveryEmailId` on its row, so
 * only the newest attempt's id ever matches.
 */
async function findRowForEmail(
  ctx: MutationCtx,
  emailId: string,
): Promise<Id<"workspaceInvites"> | Id<"calendarEventInvitees"> | null> {
  const invite = await ctx.db
    .query("workspaceInvites")
    .withIndex("by_delivery_email", (q) => q.eq("deliveryEmailId", emailId))
    .unique();
  if (invite) return invite._id;

  const invitee = await ctx.db
    .query("calendarEventInvitees")
    .withIndex("by_delivery_email", (q) => q.eq("deliveryEmailId", emailId))
    .unique();
  return invitee?._id ?? null;
}

/**
 * What an event means for the row that queued it, or `null` for the events that
 * are tracked by the component but rendered nowhere (opened / clicked /
 * complained).
 */
function deliveryPatch(
  event: EmailEvent,
): { deliveryStatus: Status; deliveryError?: string | undefined } | null {
  switch (event.type) {
    case "email.delivered":
      return { deliveryStatus: "delivered", deliveryError: undefined };
    case "email.bounced":
      // The bounce reason is the whole value of this path — "mailbox does not
      // exist" is what turns a stuck `pending` row into something the sender
      // can act on.
      return { deliveryStatus: "bounced", deliveryError: bounceMessage(event) };
    // Resend's hard send failure, as opposed to a bounce, which happens after
    // the message was accepted. Different cause (an unverified domain, a
    // rejected payload), identical symptom for the recipient — so it lands the
    // same way rather than falling through.
    case "email.failed":
      return { deliveryStatus: "failed", deliveryError: event.data.failed.reason };
    case "email.delivery_delayed":
      return { deliveryStatus: "delivery_delayed" };
    case "email.sent":
      return { deliveryStatus: "sent" };
    default:
      return null;
  }
}

/**
 * Resend's bounce payload shape varies by bounce type, so the message is read
 * defensively rather than destructured — a missing reason must still record
 * *that* it bounced.
 */
function bounceMessage(event: { data?: unknown }): string {
  const data = event.data;
  if (data && typeof data === "object" && "bounce" in data) {
    const bounce = (data as { bounce?: unknown }).bounce;
    if (bounce && typeof bounce === "object" && "message" in bounce) {
      const message = (bounce as { message?: unknown }).message;
      if (typeof message === "string" && message.length > 0) return message;
    }
  }
  return "Delivery bounced";
}
