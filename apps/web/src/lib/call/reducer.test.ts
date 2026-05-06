import { describe, expect, it } from "vitest";

import {
  callReducer,
  initialCallState,
  type CallEvent,
  type CallState,
} from "./reducer";

/**
 * Replay a sequence of events against the initial state. Useful for the
 * happy-path tests so the test reads as a transcript of the real flow.
 */
function run(events: CallEvent[], from: CallState = initialCallState): CallState {
  return events.reduce(callReducer, from);
}

describe("callReducer", () => {
  describe("happy path", () => {
    it("idle → lobby → joining → joined", () => {
      const state = run([
        { type: "ENTER_LOBBY" },
        { type: "JOIN_REQUESTED" },
        { type: "TOKEN_OK", authToken: "tok", meetingId: "m1" },
        { type: "RTK_JOINED" },
      ]);

      expect(state.status).toBe("joined");
      expect(state.authToken).toBe("tok");
      expect(state.meetingId).toBe("m1");
      expect(state.error).toBeNull();
    });

    it("leave from joined returns to idle and clears credentials", () => {
      const joined = run([
        { type: "ENTER_LOBBY" },
        { type: "JOIN_REQUESTED" },
        { type: "TOKEN_OK", authToken: "tok", meetingId: "m1" },
        { type: "RTK_JOINED" },
      ]);

      const left = run([{ type: "LEAVE_REQUESTED" }, { type: "RTK_LEFT" }], joined);

      expect(left).toEqual(initialCallState);
    });
  });

  describe("token & rtk failures", () => {
    it("JOIN_FAILED during joining lands in error with reason preserved", () => {
      const state = run([
        { type: "ENTER_LOBBY" },
        { type: "JOIN_REQUESTED" },
        { type: "JOIN_FAILED", reason: "token-failed", message: "401" },
      ]);

      expect(state.status).toBe("error");
      expect(state.error).toEqual({ reason: "token-failed", message: "401" });
      expect(state.authToken).toBeNull();
      expect(state.meetingId).toBeNull();
    });

    it("RESET from error returns to idle", () => {
      const errored = run([
        { type: "ENTER_LOBBY" },
        { type: "JOIN_REQUESTED" },
        { type: "JOIN_FAILED", reason: "rtk-init-failed", message: "boom" },
      ]);

      expect(callReducer(errored, { type: "RESET" })).toEqual(initialCallState);
    });

    it("re-entering lobby from error clears the error", () => {
      const errored = run([
        { type: "ENTER_LOBBY" },
        { type: "JOIN_REQUESTED" },
        { type: "JOIN_FAILED", reason: "token-failed", message: "x" },
      ]);

      const lobby = callReducer(errored, { type: "ENTER_LOBBY" });

      expect(lobby.status).toBe("lobby");
      expect(lobby.error).toBeNull();
    });
  });

  describe("termination during joined", () => {
    it("TERMINATED from joined transitions to error and preserves meetingId", () => {
      const joined = run([
        { type: "ENTER_LOBBY" },
        { type: "JOIN_REQUESTED" },
        { type: "TOKEN_OK", authToken: "tok", meetingId: "m1" },
        { type: "RTK_JOINED" },
      ]);

      const terminated = callReducer(joined, {
        type: "TERMINATED",
        reason: "kicked",
        message: "Kicked by host",
      });

      expect(terminated.status).toBe("error");
      expect(terminated.error).toEqual({ reason: "kicked", message: "Kicked by host" });
      // meetingId preserved so the hook can clean up the right RTK instance
      expect(terminated.meetingId).toBe("m1");
    });

    it("TERMINATED from idle is a no-op (stale event)", () => {
      const next = callReducer(initialCallState, {
        type: "TERMINATED",
        reason: "network-lost",
        message: "x",
      });
      expect(next).toBe(initialCallState);
    });
  });

  describe("stale event handling", () => {
    it("TOKEN_OK arriving after LEAVE_REQUESTED is dropped", () => {
      // Race: user clicks Leave between firing the join action and the
      // token resolving. The late TOKEN_OK must not push us back into joining.
      const joined = run([
        { type: "ENTER_LOBBY" },
        { type: "JOIN_REQUESTED" },
        { type: "TOKEN_OK", authToken: "tok", meetingId: "m1" },
        { type: "RTK_JOINED" },
        { type: "LEAVE_REQUESTED" },
      ]);

      expect(joined.status).toBe("leaving");

      const lateToken = callReducer(joined, {
        type: "TOKEN_OK",
        authToken: "stale",
        meetingId: "m2",
      });

      expect(lateToken).toBe(joined);
    });

    it("RTK_JOINED while idle is dropped", () => {
      const next = callReducer(initialCallState, { type: "RTK_JOINED" });
      expect(next).toBe(initialCallState);
    });

    it("LEAVE_REQUESTED while in lobby is dropped", () => {
      const lobby = callReducer(initialCallState, { type: "ENTER_LOBBY" });
      const next = callReducer(lobby, { type: "LEAVE_REQUESTED" });
      expect(next).toBe(lobby);
    });

    it("JOIN_REQUESTED while joined is dropped (cannot rejoin from joined)", () => {
      const joined = run([
        { type: "ENTER_LOBBY" },
        { type: "JOIN_REQUESTED" },
        { type: "TOKEN_OK", authToken: "tok", meetingId: "m1" },
        { type: "RTK_JOINED" },
      ]);

      const next = callReducer(joined, { type: "JOIN_REQUESTED" });
      expect(next).toBe(joined);
    });
  });

  describe("ENTER_LOBBY idempotency", () => {
    it("re-entering lobby from lobby is a no-op shape but resets credentials", () => {
      const a = callReducer(initialCallState, { type: "ENTER_LOBBY" });
      const b = callReducer(a, { type: "ENTER_LOBBY" });
      expect(b.status).toBe("lobby");
      expect(b.authToken).toBeNull();
      expect(b.meetingId).toBeNull();
    });

    it("ENTER_LOBBY from joined is rejected (must leave first)", () => {
      const joined = run([
        { type: "ENTER_LOBBY" },
        { type: "JOIN_REQUESTED" },
        { type: "TOKEN_OK", authToken: "tok", meetingId: "m1" },
        { type: "RTK_JOINED" },
      ]);

      const next = callReducer(joined, { type: "ENTER_LOBBY" });
      expect(next).toBe(joined);
    });
  });

  describe("RTK_LEFT acceptance from error", () => {
    it("RTK_LEFT from error cleans up to idle (post-failure cleanup path)", () => {
      const errored = run([
        { type: "ENTER_LOBBY" },
        { type: "JOIN_REQUESTED" },
        { type: "TOKEN_OK", authToken: "tok", meetingId: "m1" },
        { type: "RTK_JOINED" },
        {
          type: "TERMINATED",
          reason: "network-lost",
          message: "Disconnected",
        },
      ]);

      expect(errored.status).toBe("error");

      const cleaned = callReducer(errored, { type: "RTK_LEFT" });
      expect(cleaned).toEqual(initialCallState);
    });

    it("RTK_LEFT from idle is a no-op", () => {
      const next = callReducer(initialCallState, { type: "RTK_LEFT" });
      expect(next).toBe(initialCallState);
    });
  });
});
