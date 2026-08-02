import { describe, expect, it, vi } from "vitest";
import { createSyncGuard } from "./excalidraw-sync-guard";

const silentLogger = { error: () => {} };
const flush = () => Promise.resolve();

describe("createSyncGuard", () => {
  it("contains a throwing callback instead of propagating it", () => {
    const guard = createSyncGuard({ logger: silentLogger });
    const boom = guard.wrap("test", () => {
      throw new Error("`a1` >= `a0`");
    });

    expect(() => boom()).not.toThrow();
    expect(guard.getStatus()).toMatchObject({
      degraded: true,
      failureCount: 1,
    });
    expect(guard.getStatus().lastError?.message).toBe("`a1` >= `a0`");
  });

  it("forwards arguments to a healthy callback and stays healthy", () => {
    const guard = createSyncGuard({ logger: silentLogger });
    const fn = vi.fn();

    guard.wrap("test", fn)(1, "two");

    expect(fn).toHaveBeenCalledWith(1, "two");
    expect(guard.getStatus().degraded).toBe(false);
  });

  it("recovers once a later call succeeds", async () => {
    const onStatusChange = vi.fn();
    const guard = createSyncGuard({ onStatusChange, logger: silentLogger });
    let shouldThrow = true;
    const maybeBoom = guard.wrap("test", () => {
      if (shouldThrow) throw new Error("nope");
    });

    maybeBoom();
    await flush();
    expect(onStatusChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ degraded: true }),
    );

    shouldThrow = false;
    maybeBoom();
    await flush();
    expect(guard.getStatus()).toMatchObject({
      degraded: false,
      failureCount: 1,
    });
    expect(onStatusChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ degraded: false }),
    );
  });

  it("reports status changes asynchronously, not during the failing call", () => {
    const onStatusChange = vi.fn();
    const guard = createSyncGuard({ onStatusChange, logger: silentLogger });

    guard.wrap("test", () => {
      throw new Error("nope");
    })();

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("only notifies on transitions", async () => {
    const onStatusChange = vi.fn();
    const guard = createSyncGuard({ onStatusChange, logger: silentLogger });
    const boom = guard.wrap("test", () => {
      throw new Error("nope");
    });

    boom();
    boom();
    boom();
    await flush();

    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(guard.getStatus().failureCount).toBe(3);
  });

  it("stops logging after the first few failures but keeps counting", () => {
    const logger = { error: vi.fn() };
    const guard = createSyncGuard({ logger });
    const boom = guard.wrap("test", () => {
      throw new Error("nope");
    });

    for (let i = 0; i < 10; i++) boom();

    // 3 failure logs + one "further failures suppressed" notice
    expect(logger.error).toHaveBeenCalledTimes(4);
    expect(guard.getStatus().failureCount).toBe(10);
  });

  describe("run", () => {
    it("returns the value when the call succeeds", () => {
      const guard = createSyncGuard({ logger: silentLogger });
      expect(guard.run("test", () => 42, 0)).toBe(42);
    });

    it("returns the fallback when the call throws", () => {
      const guard = createSyncGuard({ logger: silentLogger });
      const elements = guard.run<unknown[]>(
        "test",
        () => {
          throw new Error("malformed yjs state");
        },
        [],
      );

      expect(elements).toEqual([]);
      expect(guard.getStatus().degraded).toBe(true);
    });
  });

  describe("guardApi", () => {
    it("wraps onChange subscribers so their throws never reach Excalidraw", () => {
      const guard = createSyncGuard({ logger: silentLogger });
      let subscriber: (() => void) | null = null;
      const api = {
        onChange: (cb: () => void) => {
          subscriber = cb;
          return () => {
            subscriber = null;
          };
        },
      };

      const unsubscribe = guard.guardApi(api).onChange(() => {
        throw new Error("binding blew up");
      });

      expect(subscriber).not.toBeNull();
      // Excalidraw dispatching the change must not see the throw.
      expect(() => subscriber?.()).not.toThrow();
      expect(guard.getStatus().degraded).toBe(true);

      unsubscribe();
      expect(subscriber).toBeNull();
    });

    it("forwards other members and preserves the real receiver", () => {
      const guard = createSyncGuard({ logger: silentLogger });
      const api = {
        elements: ["a"],
        onChange: () => () => {},
        getSceneElements(this: { elements: string[] }) {
          return this.elements;
        },
      };

      const guarded = guard.guardApi(api);

      expect(guarded.elements).toEqual(["a"]);
      expect(guarded.getSceneElements()).toEqual(["a"]);
    });
  });
});
