import { describe, expect, it, vi } from "vitest";
import {
  clearCollaborationTokenCache,
  fetchCollaborationToken,
  invalidateCollaborationToken,
  type CollaborationToken,
} from "./collaboration-token-cache";

/** Build a token in the wire format the partykit worker verifies. */
function signedToken(opts: { expiresInMs: number; sub?: string }): string {
  const payload = {
    sub: opts.sub ?? "u_alice",
    name: "Alice",
    img: null,
    room: "doc-d1",
    exp: Date.now() + opts.expiresInMs,
  };
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${payloadB64}.signature`;
}

describe("fetchCollaborationToken", () => {
  it("fetches on a miss and returns the result", async () => {
    const token = signedToken({ expiresInMs: 5 * 60_000 });
    const fetcher = vi.fn().mockResolvedValue({ token, roomId: "doc-d1" });

    const result = await fetchCollaborationToken("doc-d1", fetcher);

    expect(result).toEqual({ token, roomId: "doc-d1" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves a still-fresh token without asking the server again", async () => {
    const token = signedToken({ expiresInMs: 5 * 60_000 });
    const fetcher = vi.fn().mockResolvedValue({ token, roomId: "doc-fresh" });

    await fetchCollaborationToken("doc-fresh", fetcher);
    const second = await fetchCollaborationToken("doc-fresh", fetcher);

    expect(second).toEqual({ token, roomId: "doc-fresh" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("coalesces callers that arrive while a fetch is in flight", async () => {
    const token = signedToken({ expiresInMs: 5 * 60_000 });
    let release!: (value: CollaborationToken) => void;
    const fetcher = vi.fn(
      () => new Promise<CollaborationToken>((resolve) => (release = resolve)),
    );

    const first = fetchCollaborationToken("doc-inflight", fetcher);
    const second = fetchCollaborationToken("doc-inflight", fetcher);
    release({ token, roomId: "doc-inflight" });

    expect(await first).toEqual({ token, roomId: "doc-inflight" });
    expect(await second).toEqual({ token, roomId: "doc-inflight" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps rooms independent", async () => {
    const docToken = signedToken({ expiresInMs: 5 * 60_000 });
    const taskToken = signedToken({ expiresInMs: 5 * 60_000 });
    const fetchDoc = vi.fn().mockResolvedValue({ token: docToken, roomId: "doc-a" });
    const fetchTask = vi.fn().mockResolvedValue({ token: taskToken, roomId: "task-b" });

    const doc = await fetchCollaborationToken("doc-a", fetchDoc);
    const task = await fetchCollaborationToken("task-b", fetchTask);

    expect(doc.roomId).toBe("doc-a");
    expect(task.roomId).toBe("task-b");
    expect(fetchDoc).toHaveBeenCalledTimes(1);
    expect(fetchTask).toHaveBeenCalledTimes(1);
  });

  it("refetches a token that is close enough to expiry to be risky", async () => {
    // A token with 30s left would very likely expire mid-handshake, or during
    // the reconnect it was fetched for.
    const stale = signedToken({ expiresInMs: 30_000 });
    const fresh = signedToken({ expiresInMs: 5 * 60_000 });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ token: stale, roomId: "doc-margin" })
      .mockResolvedValueOnce({ token: fresh, roomId: "doc-margin" });

    await fetchCollaborationToken("doc-margin", fetcher);
    const second = await fetchCollaborationToken("doc-margin", fetcher);

    expect(second.token).toBe(fresh);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure — the caller's retry reaches the server", async () => {
    const token = signedToken({ expiresInMs: 5 * 60_000 });
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ token, roomId: "doc-retry" });

    await expect(fetchCollaborationToken("doc-retry", fetcher)).rejects.toThrow(
      "network down",
    );

    const retried = await fetchCollaborationToken("doc-retry", fetcher);

    expect(retried.token).toBe(token);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects every caller coalesced onto a failing fetch", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("access revoked"));

    const first = fetchCollaborationToken("doc-shared-failure", fetcher);
    const second = fetchCollaborationToken("doc-shared-failure", fetcher);

    await expect(first).rejects.toThrow("access revoked");
    await expect(second).rejects.toThrow("access revoked");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("drops everything on clear, so a token can't outlive its session", async () => {
    // Sign out then sign in as someone else in the same tab: the next
    // connection must be made with the new user's identity, not a token
    // minted for the previous one.
    const alice = signedToken({ expiresInMs: 5 * 60_000, sub: "u_alice" });
    const bob = signedToken({ expiresInMs: 5 * 60_000, sub: "u_bob" });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ token: alice, roomId: "doc-shared" })
      .mockResolvedValueOnce({ token: bob, roomId: "doc-shared" });

    await fetchCollaborationToken("doc-shared", fetcher);
    clearCollaborationTokenCache();
    const afterSwitch = await fetchCollaborationToken("doc-shared", fetcher);

    expect(afterSwitch.token).toBe(bob);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("passes through a token whose expiry it can't read, without caching it", async () => {
    // If the token format ever changes under us, degrade to today's behaviour
    // (one fetch per caller) rather than serving something of unknown lifetime.
    const fetcher = vi
      .fn()
      .mockResolvedValue({ token: "not-a-signed-token", roomId: "doc-opaque" });

    const first = await fetchCollaborationToken("doc-opaque", fetcher);
    const second = await fetchCollaborationToken("doc-opaque", fetcher);

    expect(first.token).toBe("not-a-signed-token");
    expect(second.token).toBe("not-a-signed-token");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not let a fetch that outlived the session repopulate the cache", async () => {
    const alice = signedToken({ expiresInMs: 5 * 60_000, sub: "u_alice" });
    const bob = signedToken({ expiresInMs: 5 * 60_000, sub: "u_bob" });
    let release!: (value: CollaborationToken) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<CollaborationToken>((resolve) => (release = resolve)),
      )
      .mockResolvedValueOnce({ token: bob, roomId: "doc-raced" });

    const inflight = fetchCollaborationToken("doc-raced", fetcher);
    clearCollaborationTokenCache();
    release({ token: alice, roomId: "doc-raced" });
    await inflight;

    const afterSwitch = await fetchCollaborationToken("doc-raced", fetcher);

    expect(afterSwitch.token).toBe(bob);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidates one room without disturbing the others", async () => {
    // The server rejected this room's token, so the retry has to be a real
    // access check rather than a replay of what was just refused.
    const rejected = signedToken({ expiresInMs: 5 * 60_000 });
    const reissued = signedToken({ expiresInMs: 5 * 60_000 });
    const fetchDoc = vi
      .fn()
      .mockResolvedValueOnce({ token: rejected, roomId: "doc-rejected" })
      .mockResolvedValueOnce({ token: reissued, roomId: "doc-rejected" });
    const fetchOther = vi.fn().mockResolvedValue({
      token: signedToken({ expiresInMs: 5 * 60_000 }),
      roomId: "doc-untouched",
    });

    await fetchCollaborationToken("doc-rejected", fetchDoc);
    await fetchCollaborationToken("doc-untouched", fetchOther);

    invalidateCollaborationToken("doc-rejected");

    expect((await fetchCollaborationToken("doc-rejected", fetchDoc)).token).toBe(reissued);
    await fetchCollaborationToken("doc-untouched", fetchOther);

    expect(fetchDoc).toHaveBeenCalledTimes(2);
    expect(fetchOther).toHaveBeenCalledTimes(1);
  });
});
