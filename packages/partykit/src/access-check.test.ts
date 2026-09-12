import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_CHECK_BATCH_SIZE,
  checkRoomAccess,
  collectSubjects,
} from "./access-check";

const env = { CONVEX_SITE_URL: "https://convex.example", PARTYKIT_SECRET: "s" };

function subjectsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({ userId: `u${i}` }));
}

describe("collectSubjects", () => {
  it("collapses tabs to one subject per user and keeps a guest's share", () => {
    expect(
      collectSubjects([
        { userId: "u1", shareId: null },
        { userId: "u1", shareId: null },
        undefined,
        { userId: "" },
        { userId: "guest:abc", shareId: "share-1" },
      ]),
    ).toEqual([{ userId: "u1" }, { userId: "guest:abc", shareId: "share-1" }]);
  });
});

describe("checkRoomAccess", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("skips the request when the server has no Convex config or nobody to ask about", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await checkRoomAccess({ PARTYKIT_SECRET: "s" }, "doc-1", subjectsOf(1)),
    ).toBeNull();
    expect(await checkRoomAccess(env, "doc-1", [])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the room and its subjects once and maps the answer by user", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ access: { u0: true, u1: false } })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const access = await checkRoomAccess(env, "doc-1", subjectsOf(2));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://convex.example/collaboration/check-access");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer s");
    expect(JSON.parse(String(init.body))).toEqual({
      roomId: "doc-1",
      subjects: [{ userId: "u0" }, { userId: "u1" }],
    });
    expect([...access!]).toEqual([
      ["u0", true],
      ["u1", false],
    ]);
  });

  it("splits a big room into bounded batches", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { subjects } = JSON.parse(String(init.body)) as {
        subjects: Array<{ userId: string }>;
      };
      return new Response(
        JSON.stringify({
          access: Object.fromEntries(subjects.map((s) => [s.userId, true])),
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const access = await checkRoomAccess(
      env,
      "doc-1",
      subjectsOf(ACCESS_CHECK_BATCH_SIZE + 1),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(access?.size).toBe(ACCESS_CHECK_BATCH_SIZE + 1);
  });

  it("returns null when every request fails, and leaves unanswered users out when only some do", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    expect(await checkRoomAccess(env, "doc-1", subjectsOf(1))).toBeNull();

    const last = `u${ACCESS_CHECK_BATCH_SIZE}`;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access: { [last]: false } })),
        ),
    );
    const access = await checkRoomAccess(
      env,
      "doc-1",
      subjectsOf(ACCESS_CHECK_BATCH_SIZE + 1),
    );

    // Absent means "not revoked" — a failed batch must not evict anyone.
    expect(access?.has("u0")).toBe(false);
    expect(access?.get(last)).toBe(false);
  });
});
