import { describe, expect, it } from "vitest";
import {
  connectionStatus,
  initialConnectionState,
  reduceConnection,
  type ConnectionEvent,
  type ConnectionState,
} from "./connection-policy";

describe("connection policy", () => {
  it("reports the connection live once the provider syncs", () => {
    const { state, effects } = reduceConnection(initialConnectionState(), {
      type: "synced",
      at: 1_000,
    });

    expect(state.phase).toBe("connected");
    expect(effects).toEqual([{ type: "clear-connect-timeout" }]);
  });

  it("discards the rejected token and retries when the server refuses our auth", () => {
    const { state, effects } = reduceConnection(
      { ...initialConnectionState(), phase: "connecting" },
      { type: "auth-rejected", at: 5_000 },
    );

    // Still trying — a rejection that will be retried is not "offline".
    expect(state.phase).toBe("connecting");
    expect(effects).toEqual([
      { type: "teardown" },
      { type: "invalidate-token" },
      { type: "reconnect-after", delayMs: 2_000 },
    ]);
  });

  it("backs off exponentially and then stays offline rather than retrying forever", () => {
    let state: ConnectionState = { ...initialConnectionState(), phase: "connecting" };
    const delays: (number | "gave-up")[] = [];

    for (let attempt = 0; attempt < 4; attempt++) {
      const transition = reduceConnection(state, { type: "auth-rejected", at: attempt });
      state = transition.state;
      const retry = transition.effects.find((e) => e.type === "reconnect-after");
      delays.push(retry ? retry.delayMs : "gave-up");
    }

    expect(delays).toEqual([2_000, 4_000, 8_000, "gave-up"]);
    // Recoverable, not terminal: a later `online` event may still revive it.
    expect(state.phase).toBe("offline");
  });

  it("clears the retry budget on a successful sync, so a later failure starts over", () => {
    let state: ConnectionState = { ...initialConnectionState(), phase: "connecting" };
    state = reduceConnection(state, { type: "auth-rejected", at: 0 }).state;
    state = reduceConnection(state, { type: "auth-rejected", at: 1 }).state;
    state = reduceConnection(state, { type: "synced", at: 2 }).state;

    const { effects } = reduceConnection(state, { type: "auth-rejected", at: 3 });

    expect(effects).toContainEqual({ type: "reconnect-after", delayMs: 2_000 });
  });

  /**
   * The socket opens (101 Switching Protocols) before the server checks the
   * token, so a rejected client looks like a *successful* connection that dies
   * a moment later. y-partyserver's own reconnect counter resets on open and
   * never trips, so the only signal left is how long each connection lasted.
   */
  it("recreates the provider when the room keeps dropping us right after connecting", () => {
    let state: ConnectionState = { ...initialConnectionState(), phase: "connecting" };
    const trippedOnCycle: number[] = [];
    let now = 0;

    for (let cycle = 0; cycle < 3; cycle++) {
      state = reduceConnection(state, { type: "status-connected", at: now }).state;
      now += 500; // dropped well inside the short-lived threshold
      const transition = reduceConnection(state, { type: "status-disconnected", at: now });
      state = transition.state;
      if (transition.effects.some((e) => e.type === "reconnect-after")) {
        trippedOnCycle.push(cycle);
      }
      now += 100;
    }

    expect(trippedOnCycle).toEqual([2]);
  });

  it("leaves healthy connections alone, however often they drop", () => {
    let state: ConnectionState = { ...initialConnectionState(), phase: "connecting" };
    let now = 0;
    const effects: string[] = [];

    for (let cycle = 0; cycle < 5; cycle++) {
      state = reduceConnection(state, { type: "status-connected", at: now }).state;
      now += 30_000; // a real session, then a network blip
      const transition = reduceConnection(state, { type: "status-disconnected", at: now });
      state = transition.state;
      effects.push(...transition.effects.map((e) => e.type));
      now += 1_000;
    }

    expect(effects).not.toContain("reconnect-after");
    expect(effects).not.toContain("teardown");
  });

  it("stops for good when access is revoked, and does not come back on reconnect", () => {
    const revoked = reduceConnection(
      { ...initialConnectionState(), phase: "connected" },
      { type: "permission-revoked", at: 0 },
    );

    expect(revoked.state.phase).toBe("stopped");
    expect(revoked.effects).toEqual([
      { type: "teardown" },
      { type: "invalidate-token" },
    ]);

    // The network coming back does not restore access the server took away.
    const afterOnline = reduceConnection(revoked.state, { type: "browser-online", at: 1_000 });
    expect(afterOnline.state.phase).toBe("stopped");
    expect(afterOnline.effects).toEqual([]);
  });

  it("starts clean for a new room, so one room's verdict never binds the next", () => {
    let state: ConnectionState = { ...initialConnectionState(), phase: "connecting" };
    state = reduceConnection(state, { type: "permission-revoked", at: 0 }).state;

    // Opening a different document is a new question, not a retry of the old one.
    state = reduceConnection(state, { type: "reset", at: 1_000 }).state;

    expect(state.phase).toBe("idle");
    const { effects } = reduceConnection(state, { type: "auth-rejected", at: 2_000 });
    expect(effects).toContainEqual({ type: "reconnect-after", delayMs: 2_000 });
  });

  it("surfaces offline immediately when the token cannot be fetched, but keeps retrying", () => {
    const { state, effects } = reduceConnection(
      { ...initialConnectionState(), phase: "connecting" },
      { type: "token-failed", at: 0 },
    );

    // The user sees "offline" now rather than a spinner that resolves in 2s.
    expect(state.phase).toBe("offline");
    expect(effects).toEqual([{ type: "reconnect-after", delayMs: 2_000 }]);
  });

  it("does not attempt a connection the browser cannot make", () => {
    const { state, effects } = reduceConnection(initialConnectionState(), {
      type: "browser-offline",
      at: 0,
    });

    expect(state.phase).toBe("offline");
    expect(effects).toEqual([]);
  });

  it("falls back to offline when the connection never completes", () => {
    const { state, effects } = reduceConnection(
      { ...initialConnectionState(), phase: "connecting" },
      { type: "connect-timed-out", at: 4_000 },
    );

    expect(state.phase).toBe("offline");
    // No retry: y-partyserver is still trying on its own socket.
    expect(effects).toEqual([]);
  });

  it("hands an exhausted connection a fresh budget when the network returns", () => {
    let state: ConnectionState = { ...initialConnectionState(), phase: "connecting" };
    for (let attempt = 0; attempt < 4; attempt++) {
      state = reduceConnection(state, { type: "auth-rejected", at: attempt }).state;
    }
    expect(state.phase).toBe("offline");

    state = reduceConnection(state, { type: "browser-online", at: 10_000 }).state;
    const { effects } = reduceConnection(state, { type: "auth-rejected", at: 11_000 });

    expect(effects).toContainEqual({ type: "reconnect-after", delayMs: 2_000 });
  });
});

describe("connection status", () => {
  const statusAfter = (...events: ConnectionEvent[]) =>
    connectionStatus(
      events.reduce(
        (state, event) => reduceConnection(state, event).state,
        initialConnectionState(),
      ),
    );

  it("shows a spinner only while a connection is genuinely in flight", () => {
    expect(statusAfter()).toMatchObject({ isConnecting: true });
    expect(statusAfter({ type: "synced", at: 0 })).toEqual({
      isConnected: true,
      isConnecting: false,
      isOffline: false,
    });
  });

  it("stops spinning once a connection has been revoked", () => {
    // The old member hook left `isLoading` true here, so a revoked document
    // sat under a spinner that could never resolve.
    expect(statusAfter({ type: "permission-revoked", at: 0 })).toEqual({
      isConnected: false,
      isConnecting: false,
      isOffline: true,
    });
  });

  it("reports offline without claiming to still be connected", () => {
    expect(statusAfter({ type: "browser-offline", at: 0 })).toEqual({
      isConnected: false,
      isConnecting: false,
      isOffline: true,
    });
  });

  /**
   * `hasSynced` is a fact about history, not about the present: it records
   * that this room once handed us its state. Everything downstream that has
   * to tell "this document is empty" from "I have never seen this document"
   * is built on it.
   */
  describe("remembering that the room has answered at least once", () => {
    it("starts out not having synced", () => {
      expect(initialConnectionState().hasSynced).toBe(false);
    });

    it("records a sync and keeps it through disconnects and failures", () => {
      let state = reduceConnection(initialConnectionState(), {
        type: "synced",
        at: 1_000,
      }).state;
      expect(state.hasSynced).toBe(true);

      for (const event of [
        { type: "status-disconnected", at: 2_000 },
        { type: "browser-offline", at: 3_000 },
        { type: "connect-timed-out", at: 4_000 },
        { type: "auth-rejected", at: 5_000 },
        { type: "permission-revoked", at: 6_000 },
      ] as ConnectionEvent[]) {
        state = reduceConnection(state, event).state;
        expect(state.hasSynced).toBe(true);
      }
    });

    it("is not set by a socket that opened but never synced", () => {
      const { state } = reduceConnection(initialConnectionState(), {
        type: "status-connected",
        at: 1_000,
      });
      // The socket being up says nothing about having received the document.
      expect(state.phase).toBe("connected");
      expect(state.hasSynced).toBe(false);
    });

    it("is cleared when a different room is opened", () => {
      const synced = reduceConnection(initialConnectionState(), {
        type: "synced",
        at: 1_000,
      }).state;

      const { state } = reduceConnection(synced, { type: "reset", at: 2_000 });
      expect(state.hasSynced).toBe(false);
    });
  });

  it("reports connecting before anything has been attempted", () => {
    // Not offline: nothing has failed yet, and saying so would strand a
    // document that is about to connect.
    expect(connectionStatus(initialConnectionState())).toEqual({
      isConnected: false,
      isConnecting: true,
      isOffline: false,
    });
  });
});
