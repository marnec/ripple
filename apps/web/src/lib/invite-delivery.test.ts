import { describe, expect, it } from "vitest";
import { inviteDeliveryNotice } from "@ripple/shared/inviteDelivery";

/**
 * The rule this encodes: an invite list reports delivery only when delivery is
 * the *explanation* for a pending invite. Mail still on its way is not news —
 * showing "queued" next to every fresh invite trains the reader to ignore the
 * column, so it is exactly the failures that get a notice.
 */
describe("inviteDeliveryNotice", () => {
  it("reports a bounce with its reason", () => {
    expect(
      inviteDeliveryNotice({
        deliveryStatus: "bounced",
        deliveryError: "The recipient's mailbox does not exist.",
      }),
    ).toEqual({
      tone: "error",
      label: "Delivery failed",
      detail: "The recipient's mailbox does not exist.",
    });
  });

  it("reports a hard send failure the same way a bounce is reported", () => {
    expect(
      inviteDeliveryNotice({
        deliveryStatus: "failed",
        deliveryError: "Domain is not verified.",
      }),
    ).toEqual({
      tone: "error",
      label: "Delivery failed",
      detail: "Domain is not verified.",
    });
  });

  it("falls back to a bare label when the reason is missing", () => {
    expect(inviteDeliveryNotice({ deliveryStatus: "bounced" })).toEqual({
      tone: "error",
      label: "Delivery failed",
      detail: undefined,
    });
  });

  it("warns about a delayed delivery without calling it a failure", () => {
    expect(inviteDeliveryNotice({ deliveryStatus: "delivery_delayed" })).toEqual(
      {
        tone: "warning",
        label: "Delivery delayed",
        detail: undefined,
      },
    );
  });

  it("says nothing about mail that is on its way or already delivered", () => {
    expect(inviteDeliveryNotice({ deliveryStatus: "waiting" })).toBeNull();
    expect(inviteDeliveryNotice({ deliveryStatus: "queued" })).toBeNull();
    expect(inviteDeliveryNotice({ deliveryStatus: "sent" })).toBeNull();
    expect(inviteDeliveryNotice({ deliveryStatus: "delivered" })).toBeNull();
  });

  /**
   * Invites created before delivery tracking, and — until the Resend webhook is
   * configured on a deployment — every invite on it, since nothing ever
   * advances the status. Both must read as "no information", never as a problem.
   */
  it("says nothing when the invite has no delivery state at all", () => {
    expect(inviteDeliveryNotice({})).toBeNull();
  });

  it("says nothing for a cancelled email, which is not a delivery problem", () => {
    expect(inviteDeliveryNotice({ deliveryStatus: "cancelled" })).toBeNull();
  });
});
