// Is this import job still alive, right now?
//
// `taskImports.getActiveJobForProject` hands over the project's most recently
// active queued-or-running job as plain data and leaves the liveness question
// here. That split is not stylistic: staleness is a wall-clock question, and a
// Convex query only re-runs when its read set changes. A drain that dies writes
// nothing more, so a server-side stale filter froze at whatever it had decided
// before the deadline — the banner spun and the Import button stayed disabled
// until the hourly sweep, up to an hour later. See
// `@ripple/shared/taskImportStaleness`, which the mutation guard and the cron
// sweep still call directly; a `Date.now()` in a mutation is read once, at a
// defined point, and never has to stay true.
//
// So the deadline needs a render of its own, which is the whole job of the
// timer below.

import {
  importJobStaleAt,
  isImportJobStale,
  type ImportJobLiveness,
} from "@ripple/shared/taskImportStaleness";
import { useEffect, useState } from "react";

/**
 * The job if it is still making progress, otherwise null — including while the
 * query is still loading, so callers get one "nothing is running" answer
 * instead of an `undefined` they have to re-narrow.
 *
 * The clock is state, not a `Date.now()` read during render. Render stays pure,
 * and — with the React Compiler on — the time the answer depends on is a
 * dependency the compiler can see, so the timer's render actually recomputes
 * instead of being served from a memo keyed on an unchanged `job`.
 */
export function useLiveImportJob<T extends ImportJobLiveness>(
  job: T | null | undefined,
): T | null {
  const staleAt = job ? importJobStaleAt(job) : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (staleAt === null) return;
    // Re-armed on every heartbeat, because each one pushes the deadline out.
    // Re-syncing `now` this way is also what keeps a long-mounted page from
    // judging a freshly arrived job against the clock as of when the tab was
    // opened.
    //
    // A deadline already in the past is the same code path, clamped to fire on
    // the next macrotask, rather than a synchronous `setNow` — which is a
    // cascading render, and which `react-hooks/set-state-in-effect` rejects.
    // `staleAt` does not change in response, so this fires once per deadline.
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(staleAt - Date.now(), 0) + 1,
    );
    return () => clearTimeout(timer);
  }, [staleAt]);

  if (!job) return null;
  return isImportJobStale(job, now) ? null : job;
}
