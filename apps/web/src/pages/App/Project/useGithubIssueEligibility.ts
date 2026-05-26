import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";

const GITHUB_FEATURE_KEY = "github_integration";

export type ActiveRepoLink = FunctionReturnType<
  typeof api.integrations.core.links.linksForProject
>[number];

export interface GithubIssueEligibility {
  /** Still resolving the capability flag or the project's repo links. */
  loading: boolean;
  /** Capability enabled AND ≥1 sync-active repo connected to this project. */
  eligible: boolean;
  /** The repos a new issue could be created in (active, not billing-frozen). */
  links: ActiveRepoLink[];
}

/**
 * Whether "create a GitHub issue from a task" is offerable for a project:
 * the workspace must hold the `github_integration` capability and the project
 * must have at least one sync-active connected repo (the issue's target). The
 * returned `links` match the dispatcher's enqueue guard (active + not frozen)
 * so the UI never offers a repo the mutation would reject.
 */
export function useGithubIssueEligibility(
  projectId: Id<"projects">,
  workspaceId: Id<"workspaces">,
): GithubIssueEligibility {
  const feature = useQuery(
    api.integrations.core.entitlements.getWorkspaceFeature,
    { workspaceId, featureKey: GITHUB_FEATURE_KEY },
  );
  const links = useQuery(api.integrations.core.links.linksForProject, {
    projectId,
  });

  const activeLinks = (links ?? []).filter(
    (l) => l.status === "active" && !l.pausedByBilling,
  );

  return {
    loading: feature === undefined || links === undefined,
    eligible: Boolean(feature?.enabled) && activeLinks.length > 0,
    links: activeLinks,
  };
}
