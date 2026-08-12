/**
 * What an invite list should say about the email that announced it.
 *
 * A pending invite has two very different explanations — the recipient hasn't
 * answered, or they never got it — and until delivery was tracked the UI could
 * only ever show the first. This maps the delivery state onto the notice that
 * distinguishes them.
 *
 * Deliberately silent for every non-failure state. An invite whose mail is
 * queued, sent or delivered needs no annotation: a status shown next to all of
 * them is a status nobody reads, and the one case worth interrupting for is the
 * one where an admin has to act (fix the address, resend).
 */

export type InviteDeliveryNotice = {
  tone: "error" | "warning";
  label: string;
  /** The provider's reason, when it gave one. */
  detail: string | undefined;
};

export function inviteDeliveryNotice(invite: {
  deliveryStatus?: string;
  deliveryError?: string;
}): InviteDeliveryNotice | null {
  switch (invite.deliveryStatus) {
    // A bounce happens after Resend accepted the message; a failure happens
    // instead of that. Different causes, one meaning for the reader: this
    // person did not get the invite and will not get it by waiting.
    case "bounced":
    case "failed":
      return {
        tone: "error",
        label: "Delivery failed",
        detail: invite.deliveryError,
      };
    case "delivery_delayed":
      return {
        tone: "warning",
        label: "Delivery delayed",
        detail: invite.deliveryError,
      };
    // `waiting` / `queued` / `sent` / `delivered` — nothing to report. So is
    // `cancelled`, which only happens when we cancel an email ourselves, and
    // so is an absent status: invites predating this tracking, and every invite
    // on a deployment whose Resend webhook is not configured yet.
    default:
      return null;
  }
}
