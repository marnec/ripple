/**
 * The staleness rule is now shared, and the client is one of its callers — so
 * it is pinned here rather than only through the Convex tests that exercise it
 * from the mutation guard and the cron sweep.
 */

import { describe, expect, it } from "vitest";
import {
  IMPORT_STALE_AFTER_MS,
  importJobStaleAt,
  isImportJobStale,
} from "./taskImportStaleness";

const T0 = 1_700_000_000_000;

describe("isImportJobStale", () => {
  it("measures from the last heartbeat, not from the job's age", () => {
    // A long import: created hours ago, turned a page a minute ago. Age alone
    // would condemn it, which is the whole reason the heartbeat exists.
    const job = {
      _creationTime: T0 - 6 * 60 * 60 * 1000,
      lastProgressAt: T0 - 60 * 1000,
    };
    expect(isImportJobStale(job, T0)).toBe(false);
  });

  it("falls back to _creationTime for rows written before the heartbeat existed", () => {
    // This fallback is what lets a row already wedged in production clear
    // itself the first time anything judges it, with no backfill.
    expect(isImportJobStale({ _creationTime: T0 - IMPORT_STALE_AFTER_MS - 1 }, T0)).toBe(true);
    expect(isImportJobStale({ _creationTime: T0 - 60 * 1000 }, T0)).toBe(false);
  });

  it("is false exactly at the deadline and true just after", () => {
    // The client arms a timer on `importJobStaleAt`, so the two have to agree
    // about which side of the boundary that instant falls on — a timer that
    // fires into a still-live verdict would never re-arm.
    const job = { _creationTime: T0 };
    const deadline = importJobStaleAt(job);
    expect(deadline).toBe(T0 + IMPORT_STALE_AFTER_MS);
    expect(isImportJobStale(job, deadline)).toBe(false);
    expect(isImportJobStale(job, deadline + 1)).toBe(true);
  });
});
