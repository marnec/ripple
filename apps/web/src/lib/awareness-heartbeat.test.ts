import { describe, expect, it } from "vitest";
import { findStaleAwarenessClients } from "./awareness-heartbeat";

const NOW = 1_000_000;
const LOCAL = 1;

const meta = (entries: Array<[number, number]>) =>
  new Map(entries.map(([clientId, lastUpdated]) => [clientId, { lastUpdated }]));

describe("findStaleAwarenessClients", () => {
  it("keeps a peer that was heard from recently", () => {
    const stale = findStaleAwarenessClients(
      meta([[LOCAL, NOW], [2, NOW - 5_000]]),
      [LOCAL, 2],
      LOCAL,
      NOW,
    );

    expect(stale).toEqual([]);
  });

  it("keeps a peer whose tab is hidden and timer-throttled", () => {
    // A hidden tab still has the document open, but browsers throttle its
    // timers to about one tick a minute. Sweeping it would erase a present
    // user's cursor for everyone.
    const stale = findStaleAwarenessClients(
      meta([[LOCAL, NOW], [2, NOW - 70_000]]),
      [LOCAL, 2],
      LOCAL,
      NOW,
    );

    expect(stale).toEqual([]);
  });

  it("sweeps a peer that has gone quiet past the threshold", () => {
    const stale = findStaleAwarenessClients(
      meta([[LOCAL, NOW], [2, NOW - 150_000]]),
      [LOCAL, 2],
      LOCAL,
      NOW,
    );

    expect(stale).toEqual([2]);
  });

  it("never sweeps the local client, however quiet", () => {
    const stale = findStaleAwarenessClients(
      meta([[LOCAL, NOW - 10 * 60_000]]),
      [LOCAL],
      LOCAL,
      NOW,
    );

    expect(stale).toEqual([]);
  });

  it("sweeps a present state that has no metadata to age it", () => {
    const stale = findStaleAwarenessClients(meta([[LOCAL, NOW]]), [LOCAL, 7], LOCAL, NOW);

    expect(stale).toEqual([7]);
  });

  it("ignores metadata for clients that are no longer present", () => {
    const stale = findStaleAwarenessClients(
      meta([[LOCAL, NOW], [2, NOW - 45_000]]),
      [LOCAL],
      LOCAL,
      NOW,
    );

    expect(stale).toEqual([]);
  });

  it("honours an explicit threshold", () => {
    const args = [meta([[2, NOW - 12_000]]), [2], LOCAL, NOW] as const;

    expect(findStaleAwarenessClients(...args, 10_000)).toEqual([2]);
    expect(findStaleAwarenessClients(...args, 20_000)).toEqual([]);
  });
});
