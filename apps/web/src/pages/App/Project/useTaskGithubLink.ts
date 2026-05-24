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

export interface TaskGithubView {
  /** Whether the task is linked to a GitHub issue (false while loading too). */
  isLinked: boolean;
  /** Outbound sync failure to surface, or null when healthy / never tried. */
  syncError: TaskSyncError | null;
  /** GitHub assignees that didn't win Ripple's single `assigneeId` slot. */
  shadowAssignees: ExternalGithubUser[];
  /** Who closed the issue on GitHub, when an external actor did. */
  closedBy: ExternalGithubUser | null;
  /** ms timestamp of the last successful Ripple→GitHub description push. */
  descriptionLastSyncedAt: number | null;
  /** True once a genuine user edit touched the description (gates the sync button). */
  descriptionEdited: boolean;
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
): TaskGithubView {
  if (!link) {
    return {
      isLinked: false,
      syncError: null,
      shadowAssignees: [],
      closedBy: null,
      descriptionLastSyncedAt: null,
      descriptionEdited: false,
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
    descriptionLastSyncedAt: link.descriptionLastSyncedAt ?? null,
    descriptionEdited: link.descriptionEdited ?? false,
  };
}

export function useTaskGithubLink(taskId: Id<"tasks">): TaskGithubView {
  const link = useQuery(api.integrations.core.taskLinks.getByTask, { taskId });
  return deriveTaskGithubView(link);
}
