import type { ThreadData } from "@blocknote/core/comments";

/** Which threads the comments rail shows. Mirrors BlockNote's `ThreadsSidebar` filter. */
export type CommentFilter = "open" | "resolved" | "all";

/** Ordering of threads in the rail. `position` keeps document order (the default). */
export type CommentSort = "position" | "recent-activity" | "oldest";

export type ThreadPositions = Map<string, { from: number; to: number }>;

/** A soft-deleted thread (BlockNote keeps the record with a `deletedAt` stamp). */
function isVisible(thread: ThreadData): boolean {
  return !thread.deletedAt;
}

/** Timestamp of a thread's most recent comment, falling back to its creation date. */
function lastActivityAt(thread: ThreadData): number {
  const last = thread.comments[thread.comments.length - 1];
  return (last?.createdAt ?? thread.createdAt).getTime();
}

/** Filter out deleted threads, then apply the open/resolved/all filter. */
export function filterThreads(
  threads: ThreadData[],
  filter: CommentFilter,
): ThreadData[] {
  return threads.filter((thread) => {
    if (!isVisible(thread)) return false;
    if (filter === "open") return !thread.resolved;
    if (filter === "resolved") return thread.resolved;
    return true;
  });
}

/**
 * Sort threads for display. `position` uses each thread's anchor offset in the
 * document so the rail reads top-to-bottom like the text; threads whose anchor
 * can't be resolved (orphaned marks) sink to the bottom. Ties and the other
 * modes fall back to dates.
 */
export function sortThreads(
  threads: ThreadData[],
  sort: CommentSort,
  positions: ThreadPositions,
): ThreadData[] {
  const sorted = [...threads];
  if (sort === "position") {
    sorted.sort((a, b) => {
      const pa = positions.get(a.id)?.from ?? Number.MAX_SAFE_INTEGER;
      const pb = positions.get(b.id)?.from ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  } else if (sort === "recent-activity") {
    sorted.sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
  } else {
    sorted.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  return sorted;
}

/** Number of open (non-resolved, non-deleted) threads — drives the toggle badge. */
export function countOpenThreads(threads: ThreadData[]): number {
  return threads.filter((thread) => isVisible(thread) && !thread.resolved)
    .length;
}

/** Convenience: filter then sort in one call. */
export function visibleThreads(
  threads: ThreadData[],
  filter: CommentFilter,
  sort: CommentSort,
  positions: ThreadPositions,
): ThreadData[] {
  return sortThreads(filterThreads(threads, filter), sort, positions);
}
