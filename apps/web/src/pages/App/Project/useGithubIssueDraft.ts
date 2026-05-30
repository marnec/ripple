import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { ActiveRepoLink } from "./useGithubIssueEligibility";

export interface GithubIssueDraft {
  /** The issue title to submit (follows the source title until edited). */
  title: string;
  /** Set the title — once called, the title stops tracking the source. */
  setTitle: (value: string) => void;
  /** The chosen target repo link (defaults to the first active repo). */
  repoLinkId: Id<"projectIntegrationLinks"> | null;
  setRepoLinkId: (id: Id<"projectIntegrationLinks">) => void;
  /** Reset the draft to "following source", default repo (on dialog close). */
  reset: () => void;
}

/**
 * The repo a task's tags route to, per the admin's tag→repo rules
 * (`link.autoSelectTags`). Returns a link id only on an *unambiguous* match:
 * if the task's labels point to exactly one distinct repo. Zero matches or a
 * cross-repo conflict (labels pointing at two different repos) both return
 * `null` — "conflict ⇒ no preference". Matching is case-insensitive; rules and
 * labels are both stored normalized (trim + lowercase) so this is a plain set
 * intersection. Pure (no hooks) so it can be unit-tested directly.
 */
export function pickRepoForTags(
  links: ActiveRepoLink[],
  labels: string[],
): Id<"projectIntegrationLinks"> | null {
  const taskTags = new Set(labels.map((l) => l.trim().toLowerCase()));
  if (taskTags.size === 0) return null;

  const matched = new Set<Id<"projectIntegrationLinks">>();
  for (const link of links) {
    if ((link.autoSelectTags ?? []).some((tag) => taskTags.has(tag))) {
      matched.add(link._id);
    }
  }
  return matched.size === 1 ? [...matched][0] : null;
}

/**
 * Draft state for creating a GitHub issue from a task. The title defaults to —
 * and stays synced with — `sourceTitle` (the task title) until the user edits
 * the issue title, at which point it decouples (the slug-from-name pattern,
 * effect-free: a `null` raw value means "follow the source"). The target repo
 * defaults to the repo the task's tags route to (`pickRepoForTags`), falling
 * back to the first active connected repo when there's no unambiguous match.
 */
export function useGithubIssueDraft(
  sourceTitle: string,
  links: ActiveRepoLink[],
  labels: string[] = [],
): GithubIssueDraft {
  const [rawTitle, setRawTitle] = useState<string | null>(null);
  const [repoLinkId, setRepoLinkId] =
    useState<Id<"projectIntegrationLinks"> | null>(null);

  return {
    title: rawTitle ?? sourceTitle,
    setTitle: setRawTitle,
    repoLinkId:
      repoLinkId ?? pickRepoForTags(links, labels) ?? links[0]?._id ?? null,
    setRepoLinkId,
    reset: () => {
      setRawTitle(null);
      setRepoLinkId(null);
    },
  };
}
