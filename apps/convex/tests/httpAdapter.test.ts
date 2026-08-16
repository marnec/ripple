import { describe, it, expect, vi } from "vitest";
import {
  checkSharedSecret,
  json,
  parseRoomId,
  guarded,
  requireSharedSecret,
  roomIdError,
  timingSafeEqual,
} from "../convex/httpAdapter";
import { verifyGitlabToken } from "../convex/integrations/gitlab/webhook";

/**
 * Direct unit tests for the PartyKit route adapter — the shared-secret check,
 * roomId parse and JSON response shaping that were previously re-derived inside
 * each httpAction and reachable only through an HTTP request.
 */
describe("parseRoomId", () => {
  it("splits a roomId into its resource type and id", () => {
    expect(parseRoomId("doc-abc123", ["doc"])).toEqual({
      kind: "ok",
      resourceType: "doc",
      resourceId: "abc123",
    });
  });

  it("reports a missing roomId", () => {
    expect(parseRoomId(null, ["doc"])).toEqual({ kind: "missing" });
    expect(parseRoomId("", ["doc"])).toEqual({ kind: "missing" });
  });

  it("rejects a roomId with no separator", () => {
    expect(parseRoomId("doc", ["doc"])).toEqual({ kind: "malformed" });
  });

  it("rejects a resource type the caller did not allow", () => {
    // `presence` rooms are re-validated for access but never snapshotted, so
    // the snapshot routes must keep refusing them.
    expect(parseRoomId("presence-ws1", ["doc", "diagram"])).toEqual({
      kind: "forbidden-type",
    });
  });

  it("accepts a resource type the caller did allow", () => {
    expect(parseRoomId("presence-ws1", ["doc", "presence"])).toEqual({
      kind: "ok",
      resourceType: "presence",
      resourceId: "ws1",
    });
  });

  it("keeps dashes inside the resource id", () => {
    expect(parseRoomId("spreadsheet-k1-7a-b", ["spreadsheet"])).toEqual({
      kind: "ok",
      resourceType: "spreadsheet",
      resourceId: "k1-7a-b",
    });
  });
});

describe("timingSafeEqual", () => {
  it("accepts an exact match and rejects every near miss", () => {
    expect(timingSafeEqual("s3cret", "s3cret")).toBe(true);
    // Differs in the last byte only — the case a short-circuiting `===` leaks
    // the most information about.
    expect(timingSafeEqual("s3creT", "s3cret")).toBe(false);
    expect(timingSafeEqual("s3cre", "s3cret")).toBe(false);
    expect(timingSafeEqual("s3crett", "s3cret")).toBe(false);
  });

  it("never accepts when either side is missing or empty", () => {
    // An unconfigured secret must not authenticate a caller who also sends
    // nothing — `"" === ""` would.
    expect(timingSafeEqual("", "")).toBe(false);
    expect(timingSafeEqual(null, "s3cret")).toBe(false);
    expect(timingSafeEqual(undefined, "s3cret")).toBe(false);
    expect(timingSafeEqual("s3cret", "")).toBe(false);
    expect(timingSafeEqual("s3cret", undefined)).toBe(false);
  });

  it("is the same implementation the GitLab webhook verifies with", () => {
    // verifyGitlabToken now delegates here; this pins that there is one
    // comparator rather than two that can drift.
    expect(verifyGitlabToken("tok", "tok")).toBe(true);
    expect(verifyGitlabToken("toK", "tok")).toBe(false);
    expect(verifyGitlabToken(null, "tok")).toBe(false);
    expect(verifyGitlabToken("tok", "")).toBe(false);
  });
});

describe("checkSharedSecret", () => {
  it("accepts a matching Bearer secret", () => {
    expect(checkSharedSecret("Bearer s3cret", "s3cret")).toEqual({
      kind: "ok",
    });
  });

  it("separates an unset server secret from a bad caller secret", () => {
    // Distinct kinds because they mean different things to the operator: an
    // unset secret is our misconfiguration (500), a mismatch is the caller's
    // problem (401). An unset secret must never authenticate anyone.
    expect(checkSharedSecret("Bearer anything", undefined)).toEqual({
      kind: "unconfigured",
    });
    expect(checkSharedSecret("Bearer anything", "")).toEqual({
      kind: "unconfigured",
    });
    expect(checkSharedSecret("Bearer wrong", "s3cret")).toEqual({
      kind: "unauthorized",
    });
  });

  it("rejects a missing Authorization header", () => {
    expect(checkSharedSecret(null, "s3cret")).toEqual({
      kind: "unauthorized",
    });
  });

  it("requires the Bearer scheme rather than any 7-character prefix", () => {
    // The block-refs/block-content routes used to compare `substring(7)` with
    // no scheme check, so `Basic <secret>` — or any 7-char prefix — passed.
    expect(checkSharedSecret("Basic  s3cret", "s3cret")).toEqual({
      kind: "unauthorized",
    });
    expect(checkSharedSecret("s3cret", "s3cret")).toEqual({
      kind: "unauthorized",
    });
  });
});

describe("json", () => {
  it("serialises the body as JSON with a 200 by default", async () => {
    const res = json({ hasAccess: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ hasAccess: true });
  });

  it("carries an explicit status", async () => {
    const res = json({ error: "Missing roomId" }, 400);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing roomId" });
  });
});

describe("requireSharedSecret", () => {
  const req = (authHeader?: string) =>
    new Request("https://site.convex.site/collaboration/snapshot", {
      headers: authHeader ? { Authorization: authHeader } : {},
    });

  it("returns no response when the caller is authorised", () => {
    expect(requireSharedSecret(req("Bearer s3cret"), "s3cret", "X")).toBeNull();
  });

  it("answers 500 when the server secret is unset", async () => {
    const res = requireSharedSecret(req("Bearer s3cret"), undefined, "X");
    expect(res?.status).toBe(500);
    expect(await res?.json()).toEqual({ error: "Server configuration error" });
  });

  it("answers 401 without leaking which half of the check failed", async () => {
    const missing = requireSharedSecret(req(), "s3cret", "X");
    const wrong = requireSharedSecret(req("Bearer nope"), "s3cret", "X");
    expect([missing?.status, wrong?.status]).toEqual([401, 401]);
    expect(await missing?.json()).toEqual({ error: "Unauthorized" });
    expect(await wrong?.json()).toEqual({ error: "Unauthorized" });
  });
});

describe("roomIdError", () => {
  it("maps every non-ok parse to a 400 naming what was wrong", async () => {
    const bodyOf = async (roomId: string | null) => {
      const parsed = parseRoomId(roomId, ["doc"]);
      if (parsed.kind === "ok") throw new Error("expected a parse failure");
      const res = roomIdError(parsed);
      expect(res.status).toBe(400);
      return res.json();
    };
    expect(await bodyOf(null)).toEqual({ error: "Missing roomId" });
    expect(await bodyOf("nodash")).toEqual({ error: "Invalid roomId format" });
    expect(await bodyOf("presence-x")).toEqual({
      error: "Invalid resource type",
    });
  });
});

describe("guarded", () => {
  it("passes a successful response straight through", async () => {
    const handler = guarded("Test route", async (_ctx: null, req: Request) =>
      json({ url: req.url }),
    );
    const res = await handler(null, new Request("https://site/x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://site/x" });
  });

  it("turns a thrown error into a 500 that does not echo the error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("connection string: postgres://user:hunter2@db");
    const handler = guarded("Test route", async () => {
      throw boom;
    });

    const res = await handler(null, new Request("https://site/x"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
    expect(spy).toHaveBeenCalledWith("Test route error:", boom);
    spy.mockRestore();
  });
});
