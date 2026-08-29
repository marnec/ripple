import { describe, expect, it } from "vitest";
import {
  exitAction,
  isDirectMessage,
  isPrivateChannel,
  isPublicChannel,
} from "@ripple/shared/channel";
import { ChannelKind, ChannelVisibility } from "@ripple/shared/enums/roles";

/**
 * `packages/shared/src/channel.ts` is the deepest module in the channel
 * surface — three predicates and one action, read at roughly thirty call
 * sites across both tiers — and it had no test anywhere in the repo. Its
 * docstring states an invariant ("*that is the trap this module exists to
 * make unwritable*") that nothing was holding.
 *
 * It lives here rather than beside the source because `packages/shared` has no
 * test runner of its own, and this is where the repo's other pure tests are
 * (`mentionTitle.test.ts`, `dmLabel.test.ts`). No convex-test, no harness.
 */

const publicChannel = { kind: ChannelKind.CHANNEL, visibility: ChannelVisibility.PUBLIC };
const privateChannel = { kind: ChannelKind.CHANNEL, visibility: ChannelVisibility.PRIVATE };
// The ADR's "lie of convenience": a DM stores `visibility: "private"` so the
// column can be required. Every case below exists to prove nothing reads it.
const dm = { kind: ChannelKind.DM, visibility: ChannelVisibility.PRIVATE };
// A row predating docs/adr/0001, before the backfill reached it.
const legacy = {};

describe("channel predicates", () => {
  it("identifies each kind and visibility", () => {
    expect(isDirectMessage(dm)).toBe(true);
    expect(isPublicChannel(publicChannel)).toBe(true);
    expect(isPrivateChannel(privateChannel)).toBe(true);
  });

  it("is not a direct message unless kind says so", () => {
    expect(isDirectMessage(publicChannel)).toBe(false);
    expect(isDirectMessage(privateChannel)).toBe(false);
    expect(isDirectMessage(legacy)).toBe(false);
  });

  it("treats a DM as neither public nor private — the trap the module exists to close", () => {
    // Both predicates check `kind` first. Without that, `isPrivateChannel`
    // would be true for every DM, and "refuse this for private channels"
    // would silently refuse it for direct messages too. That is exactly the
    // rewrite `docs/adr/0001` names as the worked example: it would have
    // killed "Close conversation" for every DM.
    expect(isPublicChannel(dm)).toBe(false);
    expect(isPrivateChannel(dm)).toBe(false);
  });

  it("is not a pair of negations", () => {
    expect(isPublicChannel(dm)).toBe(isPrivateChannel(dm));
  });

  it("fails closed on a row carrying neither column", () => {
    // `!isPublicChannel(c)` is the membership gate, so a row that is not
    // recognisably public demands a `channelMembers` row rather than
    // admitting the whole workspace.
    expect(isPublicChannel(legacy)).toBe(false);
    expect(isPrivateChannel(legacy)).toBe(false);
  });
});

describe("exitAction", () => {
  it("dismisses a direct message", () => {
    // A DM can be neither deleted nor left, so dismissal is its whole
    // lifecycle. Membership is irrelevant — only participants reach one.
    expect(exitAction(dm, { isMember: true })).toBe("dismiss");
    expect(exitAction(dm, { isMember: false })).toBe("dismiss");
  });

  it("dismisses a public channel whether or not the viewer has a member row", () => {
    // A public channel has no roster to leave. `channelMembers.addToChannel`
    // does permit a row on one, so both cases are reachable, and dismissal is
    // the answer either way.
    expect(exitAction(publicChannel, { isMember: false })).toBe("dismiss");
    expect(exitAction(publicChannel, { isMember: true })).toBe("dismiss");
  });

  it("leaves a private channel the viewer is a member of", () => {
    expect(exitAction(privateChannel, { isMember: true })).toBe("leave");
  });

  it("offers nothing on a private channel the viewer is not in", () => {
    // Nothing to leave and nothing to dismiss. This is the case a bare
    // `exitAction(channel)` could not express, and the reason `isMember` is
    // required rather than optional.
    expect(exitAction(privateChannel, { isMember: false })).toBe("none");
  });

  it("offers nothing on an unrecognised row", () => {
    // Offering no exit is recoverable; offering the wrong one is not.
    expect(exitAction(legacy, { isMember: true })).toBe("none");
    expect(exitAction(legacy, { isMember: false })).toBe("none");
  });

  it("never answers both dismiss and leave", () => {
    // The property that makes this a closed set rather than two booleans.
    for (const channel of [publicChannel, privateChannel, dm, legacy]) {
      for (const isMember of [true, false]) {
        expect(["dismiss", "leave", "none"]).toContain(exitAction(channel, { isMember }));
      }
    }
  });
});
