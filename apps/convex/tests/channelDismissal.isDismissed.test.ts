import { describe, expect, it, vi } from "vitest";
import { isDismissed } from "../convex/channelDismissal";
import { ChannelKind, ChannelVisibility } from "@ripple/shared/enums/roles";

/**
 * The read half of **dismissal**, tested through its own interface.
 *
 * These assertions used to be reachable only by standing up a workspace, a
 * membership, a channel, a `userChannelState` row and a message, then reading
 * `workspaceSidebarData.get` and inspecting one boolean on one element of its
 * result — because that query was where the rule was implemented. The
 * sidebar-driven cases in `channelDismissal.test.ts` still cover the wiring;
 * what is here is the rule.
 */

const publicChannel = {
  kind: ChannelKind.CHANNEL,
  visibility: ChannelVisibility.PUBLIC,
};
const privateChannel = {
  kind: ChannelKind.CHANNEL,
  visibility: ChannelVisibility.PRIVATE,
};
// A DM stores `visibility: "private"` — the ADR's "lie of convenience". These
// cases are the ones that would break if anything started reading it.
const dm = { kind: ChannelKind.DM, visibility: ChannelVisibility.PRIVATE };

/** A thunk that records whether the rule asked for a message read. */
function latestMessage(at: number | undefined) {
  return vi.fn(async () => at);
}

describe("isDismissed", () => {
  describe("no hiddenAt", () => {
    it("is not dismissed, whatever the channel is", async () => {
      for (const channel of [publicChannel, privateChannel, dm]) {
        expect(await isDismissed(channel, undefined, latestMessage(1))).toBe(false);
      }
    });

    it("does not read messages", async () => {
      const read = latestMessage(999);
      await isDismissed(dm, undefined, read);
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("public channel", () => {
    it("stays dismissed for any hiddenAt — only restoreChannel clears it", async () => {
      expect(await isDismissed(publicChannel, 100, latestMessage(999))).toBe(true);
    });

    it("stays dismissed even when a newer message exists", async () => {
      // The DM auto-restore must not leak onto channels: a public channel you
      // declined should not come back because somebody posted in it.
      expect(await isDismissed(publicChannel, 100, latestMessage(500))).toBe(true);
    });

    it("does not pay for a message read", async () => {
      // The performance half of the rule, and the reason `latestMessageAt` is
      // a thunk rather than a value.
      const read = latestMessage(500);
      await isDismissed(publicChannel, 100, read);
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("private channel", () => {
    it("is never dismissed, even carrying a stale hiddenAt", async () => {
      // Private channels are left, not dismissed. `dismissChannel` refuses
      // one, but a row can predate that or survive a channel changing shape,
      // and the answer must still be "not dismissed" rather than "hidden
      // forever with no way back" — there is no unhide control for a channel
      // you are a member of.
      expect(await isDismissed(privateChannel, 100, latestMessage(50))).toBe(false);
    });

    it("does not pay for a message read", async () => {
      const read = latestMessage(50);
      await isDismissed(privateChannel, 100, read);
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("direct message", () => {
    it("auto-restores when a message is newer than hiddenAt", async () => {
      expect(await isDismissed(dm, 100, latestMessage(101))).toBe(false);
    });

    it("stays dismissed when the newest message is older", async () => {
      expect(await isDismissed(dm, 100, latestMessage(99))).toBe(true);
    });

    it("stays dismissed when the newest message is exactly hiddenAt", async () => {
      // The dismissal write stamps `Date.now()`, so the message that was on
      // screen when you closed the conversation can share its timestamp.
      // Inclusive here, or closing a DM you just read reopens it at once.
      expect(await isDismissed(dm, 100, latestMessage(100))).toBe(true);
    });

    it("stays dismissed when the conversation holds no messages at all", async () => {
      expect(await isDismissed(dm, 100, latestMessage(undefined))).toBe(true);
    });

    it("reads messages exactly once", async () => {
      const read = latestMessage(101);
      await isDismissed(dm, 100, read);
      expect(read).toHaveBeenCalledTimes(1);
    });
  });

  describe("a row that predates the kind/visibility split", () => {
    it("is not dismissed — the predicates fail closed", async () => {
      // `kind: undefined` is neither a public channel nor a DM, so this lands
      // on the private-channel answer. Failing closed here means "still in
      // your sidebar", which is the recoverable direction.
      expect(await isDismissed({}, 100, latestMessage(50))).toBe(false);
    });
  });
});
