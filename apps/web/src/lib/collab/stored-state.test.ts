import { afterEach, describe, expect, it, vi } from "vitest";
import { isKnowledge, readStoredState, type StoredStateQuery } from "./stored-state";

/**
 * The cold-start read, exercised without rendering anything. Every branch here
 * used to live inside a `useEffect` in a 500-line hook, reachable only by
 * driving a fake provider to the offline state first.
 */

const RESOURCE = { resourceType: "doc" as const, resourceId: "abc123" };

const answering = (answer: Awaited<ReturnType<StoredStateQuery>>): StoredStateQuery =>
  vi.fn(async () => answer);

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Partial<Response> & { ok: boolean }) {
  const fetchMock = vi.fn(async () => response as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("readStoredState", () => {
  it("returns the snapshot bytes when one is stored", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    stubFetch({ ok: true, arrayBuffer: async () => bytes.buffer });

    const result = await readStoredState(
      answering({ status: "stored", url: "https://storage/blob" }),
      RESOURCE,
    );

    expect(result).toEqual({ status: "content", update: bytes });
    expect(isKnowledge(result)).toBe(true);
  });

  it("passes `empty` straight through, and counts it as knowledge", async () => {
    // The distinction the whole module exists for: nothing has ever been
    // stored is a statement about the contents, so the replica is hydrated.
    const result = await readStoredState(answering({ status: "empty" }), RESOURCE);

    expect(result).toEqual({ status: "empty" });
    expect(isKnowledge(result)).toBe(true);
  });

  it("does not treat `unavailable` as knowledge", async () => {
    const result = await readStoredState(answering({ status: "unavailable" }), RESOURCE);

    expect(result).toEqual({ status: "unavailable" });
    expect(isKnowledge(result)).toBe(false);
  });

  it("never fetches unless something is actually stored", async () => {
    const fetchMock = stubFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });

    await readStoredState(answering({ status: "empty" }), RESOURCE);
    await readStoredState(answering({ status: "unavailable" }), RESOURCE);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a non-OK blob response as failed, not as content", async () => {
    // Without the `response.ok` check the 404 body is read as a snapshot and
    // those bytes reach `Y.applyUpdate`.
    stubFetch({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(8) });

    const result = await readStoredState(
      answering({ status: "stored", url: "https://storage/gone" }),
      RESOURCE,
    );

    expect(result.status).toBe("failed");
    expect(isKnowledge(result)).toBe(false);
  });

  it("reports a thrown query as failed, so the caller can try again", async () => {
    const boom = new Error("offline");
    const result = await readStoredState(
      vi.fn(async () => {
        throw boom;
      }),
      RESOURCE,
    );

    expect(result).toEqual({ status: "failed", error: boom });
  });

  it("reports a thrown fetch as failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network error");
      }),
    );

    const result = await readStoredState(
      answering({ status: "stored", url: "https://storage/blob" }),
      RESOURCE,
    );

    expect(result.status).toBe("failed");
  });

  it("asks about the resource it was given", async () => {
    const query = answering({ status: "empty" });
    await readStoredState(query, RESOURCE);

    expect(query).toHaveBeenCalledWith(RESOURCE);
  });
});
