import { describe, expect, it } from "vitest";
import { groupCallsByChannel } from "./use-channel-calls";
import type { PresenceEntry } from "./use-workspace-presence";

const entry = (
  userId: string,
  overrides: Partial<PresenceEntry> = {},
): PresenceEntry => ({
  userId,
  userName: userId.toUpperCase(),
  userImage: null,
  currentPath: "/workspaces/w1",
  ...overrides,
});

describe("groupCallsByChannel", () => {
  it("returns nothing when nobody is in a call", () => {
    expect(
      groupCallsByChannel([entry("alice"), entry("bob")]).size,
    ).toBe(0);
  });

  it("groups participants by the channel they are calling in", () => {
    const calls = groupCallsByChannel([
      entry("alice", { callChannelId: "ch1" }),
      entry("bob", { callChannelId: "ch1" }),
      entry("carol", { callChannelId: "ch2" }),
      entry("dave"),
    ]);

    expect(calls.get("ch1")?.participants.map((p) => p.userId)).toEqual([
      "alice",
      "bob",
    ]);
    expect(calls.get("ch2")?.participants.map((p) => p.userId)).toEqual(["carol"]);
    expect(calls.has("ch3")).toBe(false);
  });

  it("counts a participant who has navigated away from the call route", () => {
    // The floating call window keeps the call alive across navigation, which
    // is exactly why membership is not derived from `currentPath`.
    const calls = groupCallsByChannel([
      entry("alice", {
        callChannelId: "ch1",
        currentPath: "/workspaces/w1/documents/d1",
        resourceType: "document",
        resourceId: "d1",
      }),
    ]);

    expect(calls.get("ch1")?.participants.map((p) => p.userId)).toEqual(["alice"]);
  });

  it("orders participants deterministically", () => {
    const forward = groupCallsByChannel([
      entry("alice", { callChannelId: "ch1" }),
      entry("bob", { callChannelId: "ch1" }),
    ]);
    const reverse = groupCallsByChannel([
      entry("bob", { callChannelId: "ch1" }),
      entry("alice", { callChannelId: "ch1" }),
    ]);

    expect(forward.get("ch1")).toEqual(reverse.get("ch1"));
  });

  it("reports the transcription mode when a participant knows it", () => {
    const calls = groupCallsByChannel([
      entry("alice", { callChannelId: "ch1", callTranscribing: true }),
      entry("bob", { callChannelId: "ch1", callTranscribing: true }),
    ]);

    expect(calls.get("ch1")?.transcribing).toBe(true);
  });

  it("distinguishes transcription off from unknown", () => {
    const off = groupCallsByChannel([
      entry("alice", { callChannelId: "ch1", callTranscribing: false }),
    ]);
    const unknown = groupCallsByChannel([
      entry("alice", { callChannelId: "ch1" }),
    ]);

    // `false` and `undefined` mean different things to the lobby: one shows
    // "not being transcribed", the other refuses to claim either way.
    expect(off.get("ch1")?.transcribing).toBe(false);
    expect(unknown.get("ch1")?.transcribing).toBeUndefined();
  });

  it("takes the mode from a knowing participant when a peer reports none", () => {
    // A peer on a client predating `callTranscribing` publishes the channel but
    // not the mode. It must not shadow a participant who does know.
    const calls = groupCallsByChannel([
      entry("alice", { callChannelId: "ch1" }),
      entry("bob", { callChannelId: "ch1", callTranscribing: true }),
    ]);

    expect(calls.get("ch1")?.transcribing).toBe(true);
  });
});
