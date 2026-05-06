import { describe, expect, it } from "vitest";

import {
  isCallBusyForOtherResource,
  type CallSourceDescriptor,
} from "./source-port";

const channelA: CallSourceDescriptor = {
  kind: "channel",
  resourceId: "channelA",
  workspaceId: "ws1" as CallSourceDescriptor["workspaceId"],
  label: "Channel A",
  homePath: "/workspaces/ws1/channels/channelA/videocall",
  leaveDestination: "/workspaces/ws1/channels/channelA",
};

describe("isCallBusyForOtherResource", () => {
  it("returns false when no call is active", () => {
    expect(isCallBusyForOtherResource(null, "idle", "channelA")).toBe(false);
  });

  it("returns false when the active call is the same resource", () => {
    expect(isCallBusyForOtherResource(channelA, "joined", "channelA")).toBe(false);
    expect(isCallBusyForOtherResource(channelA, "joining", "channelA")).toBe(false);
    expect(isCallBusyForOtherResource(channelA, "lobby", "channelA")).toBe(false);
  });

  it("returns true when joined to a different resource", () => {
    expect(isCallBusyForOtherResource(channelA, "joined", "channelB")).toBe(true);
  });

  it("returns true when joining a different resource (in flight)", () => {
    expect(isCallBusyForOtherResource(channelA, "joining", "channelB")).toBe(true);
  });

  it("returns true when in lobby for a different resource (rare but possible)", () => {
    // Pre-commit lobby for resource A; user navigates to resource B's
    // route. Treat as busy so the busy screen offers the switch — the
    // session layer would otherwise allow silent source replacement,
    // which is fine but the UX should still be deliberate.
    expect(isCallBusyForOtherResource(channelA, "lobby", "channelB")).toBe(true);
  });

  it("returns false from error state — error is recoverable, user can re-enter freely", () => {
    expect(isCallBusyForOtherResource(channelA, "error", "channelB")).toBe(false);
  });

  it("returns false from idle even with a stale descriptor", () => {
    // Defensive: shouldn't happen in practice, but if a descriptor
    // somehow lingers in idle state, we don't gate on it.
    expect(isCallBusyForOtherResource(channelA, "idle", "channelB")).toBe(false);
  });
});
