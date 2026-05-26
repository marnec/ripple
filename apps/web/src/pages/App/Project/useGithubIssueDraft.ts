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
 * Draft state for creating a GitHub issue from a task. The title defaults to —
 * and stays synced with — `sourceTitle` (the task title) until the user edits
 * the issue title, at which point it decouples (the slug-from-name pattern,
 * effect-free: a `null` raw value means "follow the source"). The target repo
 * defaults to the first active connected repo.
 */
export function useGithubIssueDraft(
  sourceTitle: string,
  links: ActiveRepoLink[],
): GithubIssueDraft {
  const [rawTitle, setRawTitle] = useState<string | null>(null);
  const [repoLinkId, setRepoLinkId] =
    useState<Id<"projectIntegrationLinks"> | null>(null);

  return {
    title: rawTitle ?? sourceTitle,
    setTitle: setRawTitle,
    repoLinkId: repoLinkId ?? links[0]?._id ?? null,
    setRepoLinkId,
    reset: () => {
      setRawTitle(null);
      setRepoLinkId(null);
    },
  };
}
