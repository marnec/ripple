import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

/**
 * Single boundary for the task-detail GitHub link.
 *
 * Three task-detail components (`TaskSyncIndicator`, `TaskGithubExternalInfo`,
 * `TaskDescriptionSyncButton`) used to each `useQuery(taskLinks.getByTask)` and
 * read raw link fields with their own inline derivations. This hook is the one
 * place that names the query and shapes a typed view model; the per-component
 * derivations (e.g. the sync-error chip label) move into the pure
 * `deriveTaskGithubView` so they're unit-testable without a Convex provider.
 *
 * (Convex already collapses the three identical subscriptions into one at the
 * client cache; this consolidates the *code* seam, not the wire.)
 */

type TaskGithubLink = NonNullable<
  FunctionReturnType<typeof api.integrations.core.taskLinks.getByTask>
>;

export interface ExternalGithubUser {
  login: string;
  avatarUrl: string;
  url: string;
}

export interface TaskSyncError {
  message: string;
  httpStatus?: number;
  /** Short chip label: `HTTP <code>` when known, else `AUTH` / `NET`. */
  label: string;
}

/**
 * GitHub description-seed inputs for the editor gate. Mirrors the link's
 * one-shot seed lifecycle; `statusLoading` is true only while the link query
 * is in flight for a present task (so the editor stays gated until we know
 * whether a seed is coming). `edited` lives on the view model proper
 * (`descriptionEdited`), not here.
 */
export interface TaskGithubSeed {
  expected: boolean;
  snapshotId: string | null;
  seedStatus?: "pending" | "seeded" | "skipped" | "failed";
  statusLoading: boolean;
}

export interface TaskGithubView {
  /** Whether the task is linked to a GitHub issue (false while loading too). */
  isLinked: boolean;
  /** Outbound sync failure to surface, or null when healthy / never tried. */
  syncError: TaskSyncError | null;
  /** GitHub assignees that didn't win Ripple's single `assigneeId` slot. */
  shadowAssignees: ExternalGithubUser[];
  /** Who closed the issue on GitHub, when an external actor did. */
  closedBy: ExternalGithubUser | null;
  /** True once the linked GitHub issue has been deleted upstream. The link is
   *  orphaned (outbound sync stops) but the Ripple task is preserved. */
  issueDeleted: boolean;
  /** ms timestamp of the last successful Ripple→GitHub description push. */
  descriptionLastSyncedAt: number | null;
  /** True once a genuine user edit touched the description (gates the sync button). */
  descriptionEdited: boolean;
  /** Description-seed inputs for the editor gate. */
  seed: TaskGithubSeed;
}

/**
 * Short label for the sync-failure chip. HTTP status wins when present;
 * otherwise distinguish an auth/credentials failure from a generic network
 * one. Pure so the brittle string match has a unit-tested home.
 */
export function deriveSyncErrorLabel(
  message: string,
  httpStatus?: number,
): string {
  if (typeof httpStatus === "number") return `HTTP ${httpStatus}`;
  return /credentials/i.test(message) ? "AUTH" : "NET";
}

/**
 * Shape the raw `getByTask` result (which is `undefined` while loading, `null`
 * for a Ripple-native task, or the link object) into the view model the
 * task-detail components render. Loading and unlinked both yield
 * `isLinked: false` so callers keep their existing "render nothing" guard.
 */
export function deriveTaskGithubView(
  link: TaskGithubLink | null | undefined,
  opts: { loading?: boolean } = {},
): TaskGithubView {
  if (!link) {
    return {
      isLinked: false,
      syncError: null,
      shadowAssignees: [],
      closedBy: null,
      issueDeleted: false,
      descriptionLastSyncedAt: null,
      descriptionEdited: false,
      seed: {
        expected: false,
        snapshotId: null,
        seedStatus: undefined,
        statusLoading: opts.loading ?? false,
      },
    };
  }
  return {
    isLinked: true,
    syncError: link.lastSyncError
      ? {
          message: link.lastSyncError.message,
          httpStatus: link.lastSyncError.httpStatus,
          label: deriveSyncErrorLabel(
            link.lastSyncError.message,
            link.lastSyncError.httpStatus,
          ),
        }
      : null,
    shadowAssignees: link.externalAssignees ?? [],
    closedBy: link.externalClosedBy ?? null,
    issueDeleted: link.externalDeletedAt !== undefined,
    descriptionLastSyncedAt: link.descriptionLastSyncedAt ?? null,
    descriptionEdited: link.descriptionEdited ?? false,
    // A resolved link is never "loading" — the seed gate keys off seedStatus.
    seed: {
      expected: link.seedExpected,
      snapshotId: link.descriptionSnapshotId,
      seedStatus: link.seedStatus,
      statusLoading: false,
    },
  };
}

/**
 * Subscribe to a task's GitHub link and shape it. Accepts a null `taskId`
 * (skips the query) so callers like `useTaskDetail` that may have no task can
 * consume the same single boundary instead of re-querying `getByTask`.
 */
export function useTaskGithubLink(
  taskId: Id<"tasks"> | null,
): TaskGithubView {
  const link = useQuery(
    api.integrations.core.taskLinks.getByTask,
    taskId ? { taskId } : "skip",
  );
  return deriveTaskGithubView(link, {
    loading: taskId !== null && link === undefined,
  });
}
