import { describe, expect, it } from "vitest";
import { PresenceRegistry } from "./presence-registry";

const alice = { userId: "u_alice", userName: "Alice", userImage: null };
const bob = { userId: "u_bob", userName: "Bob", userImage: null };

const at = (path: string) => ({ currentPath: path });

describe("PresenceRegistry", () => {
  it("reports a connection only once it has a location", () => {
    const registry = new PresenceRegistry();
    registry.add("c1", alice);
    expect(registry.snapshot()).toEqual([]);

    registry.update("c1", at("/doc/1"));
    expect(registry.snapshot()).toEqual([{ ...alice, currentPath: "/doc/1" }]);
  });

  it("carries resource fields through to the derived entry", () => {
    const registry = new PresenceRegistry();
    registry.add("c1", alice);
    const entry = registry.update("c1", {
      currentPath: "/doc/1",
      resourceType: "document",
      resourceId: "d1",
    });

    expect(entry).toEqual({
      ...alice,
      currentPath: "/doc/1",
      resourceType: "document",
      resourceId: "d1",
    });
  });

  it("collapses a user's tabs to one entry, won by the latest update", () => {
    const registry = new PresenceRegistry();
    registry.add("tabA", alice);
    registry.add("tabB", alice);

    registry.update("tabA", at("/doc/1"));
    registry.update("tabB", at("/channel/2"));

    expect(registry.snapshot()).toEqual([{ ...alice, currentPath: "/channel/2" }]);

    // The older tab navigating takes the user back
    registry.update("tabA", at("/doc/3"));
    expect(registry.snapshot()).toEqual([{ ...alice, currentPath: "/doc/3" }]);
  });

  it("keeps users independent", () => {
    const registry = new PresenceRegistry();
    registry.add("c1", alice);
    registry.add("c2", bob);
    registry.update("c1", at("/doc/1"));
    registry.update("c2", at("/channel/2"));

    expect(registry.snapshot()).toEqual([
      { ...alice, currentPath: "/doc/1" },
      { ...bob, currentPath: "/channel/2" },
    ]);
  });

  it("says nothing when a tab that wasn't representing the user closes", () => {
    const registry = new PresenceRegistry();
    registry.add("tabA", alice);
    registry.add("tabB", alice);
    registry.update("tabA", at("/doc/1"));
    registry.update("tabB", at("/channel/2"));

    expect(registry.remove("tabA")).toBeNull();
    expect(registry.snapshot()).toEqual([{ ...alice, currentPath: "/channel/2" }]);
  });

  it("falls back to a surviving tab when the representing tab closes", () => {
    // Regression: a per-user map left the user pinned to the closed tab's
    // location until some other tab happened to navigate.
    const registry = new PresenceRegistry();
    registry.add("tabA", alice);
    registry.add("tabB", alice);
    registry.update("tabA", at("/doc/1"));
    registry.update("tabB", at("/channel/2"));

    expect(registry.remove("tabB")).toEqual({
      kind: "changed",
      entry: { ...alice, currentPath: "/doc/1" },
    });
    expect(registry.snapshot()).toEqual([{ ...alice, currentPath: "/doc/1" }]);
  });

  it("reports a leave only when the last tab closes", () => {
    const registry = new PresenceRegistry();
    registry.add("tabA", alice);
    registry.add("tabB", alice);
    registry.update("tabA", at("/doc/1"));
    registry.update("tabB", at("/channel/2"));

    registry.remove("tabB");
    expect(registry.remove("tabA")).toEqual({ kind: "left", userId: alice.userId });
    expect(registry.snapshot()).toEqual([]);
  });

  it("reports a leave when the only tab closes before reporting a location", () => {
    const registry = new PresenceRegistry();
    registry.add("c1", alice);
    expect(registry.remove("c1")).toEqual({ kind: "left", userId: alice.userId });
  });

  it("stays quiet when the surviving tab hasn't reported a location yet", () => {
    // The survivor sends its first update on open, milliseconds behind; there
    // is nothing accurate to broadcast in between, and the user has not left.
    const registry = new PresenceRegistry();
    registry.add("tabA", alice);
    registry.update("tabA", at("/doc/1"));
    registry.add("tabB", alice);

    expect(registry.remove("tabA")).toBeNull();
    expect(registry.snapshot()).toEqual([]);

    registry.update("tabB", at("/channel/2"));
    expect(registry.snapshot()).toEqual([{ ...alice, currentPath: "/channel/2" }]);
  });

  it("carries call membership through to the derived entry", () => {
    const registry = new PresenceRegistry();
    registry.add("c1", alice);
    const entry = registry.update("c1", {
      currentPath: "/workspaces/w1/channels/ch1/videocall",
      callChannelId: "ch1",
    });

    expect(entry).toMatchObject({ callChannelId: "ch1" });
  });

  it("keeps a user in their call when another tab reports a different page", () => {
    // The location is the tab you are looking at, so the browsing tab wins it.
    // Call membership is not — dropping it here would blink the sidebar
    // indicator off every time a participant switched tabs.
    const registry = new PresenceRegistry();
    registry.add("callTab", alice);
    registry.add("browseTab", alice);

    registry.update("callTab", {
      currentPath: "/workspaces/w1/channels/ch1/videocall",
      callChannelId: "ch1",
    });
    const entry = registry.update("browseTab", at("/workspaces/w1/projects/p1"));

    expect(entry).toEqual({
      ...alice,
      currentPath: "/workspaces/w1/projects/p1",
      callChannelId: "ch1",
    });
    expect(registry.snapshot()).toEqual([
      {
        ...alice,
        currentPath: "/workspaces/w1/projects/p1",
        callChannelId: "ch1",
      },
    ]);
  });

  it("drops call membership when the tab holding the call closes", () => {
    const registry = new PresenceRegistry();
    registry.add("callTab", alice);
    registry.add("browseTab", alice);
    registry.update("callTab", {
      currentPath: "/workspaces/w1/channels/ch1/videocall",
      callChannelId: "ch1",
    });
    registry.update("browseTab", at("/workspaces/w1/projects/p1"));

    registry.remove("callTab");

    expect(registry.snapshot()).toEqual([
      { ...alice, currentPath: "/workspaces/w1/projects/p1" },
    ]);
  });

  it("reports one call per participant, so a call groups by channel", () => {
    const registry = new PresenceRegistry();
    registry.add("a1", alice);
    registry.add("b1", bob);
    registry.update("a1", { currentPath: "/c/ch1", callChannelId: "ch1" });
    registry.update("b1", { currentPath: "/elsewhere", callChannelId: "ch1" });

    expect(
      registry.snapshot().map((e) => [e.userId, e.callChannelId]),
    ).toEqual([
      ["u_alice", "ch1"],
      ["u_bob", "ch1"],
    ]);
  });

  it("ignores unknown connections", () => {
    const registry = new PresenceRegistry();
    expect(registry.update("ghost", at("/doc/1"))).toBeNull();
    expect(registry.remove("ghost")).toBeNull();
    expect(registry.snapshot()).toEqual([]);
  });

  it("does not resurrect a user after their last tab closes", () => {
    const registry = new PresenceRegistry();
    registry.add("c1", alice);
    registry.update("c1", at("/doc/1"));
    registry.remove("c1");

    expect(registry.update("c1", at("/doc/2"))).toBeNull();
    expect(registry.snapshot()).toEqual([]);
  });
});
