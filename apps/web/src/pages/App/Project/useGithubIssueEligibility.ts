import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";

const GITHUB_FEATURE_KEY = "github_integration";
const GITLAB_FEATURE_KEY = "gitlab_integration";

export type ActiveRepoLink = FunctionReturnType<
  typeof api.integrations.core.links.linksForProject
>[number];

export interface GithubIssueEligibility {
  /** Still resolving any capability flag or the project's repo links. */
  loading: boolean;
  /** Capability for the linked provider enabled AND ≥1 sync-active repo connected. */
  eligible: boolean;
  /** The project's integration provider ("github"/"gitlab"), or "github" when
   *  no link is present (callers gate on `eligible` before using copy). A
   *  project carries at most one provider type (server-enforced), so any
   *  active link's provider is the project's. */
  provider: string;
  /** The repos a new issue could be created in (active, not billing-frozen). */
  links: ActiveRepoLink[];
}

/**
 * Whether "create an issue from a task" is offerable for a project: the
 * workspace must hold the integration capability for the project's connected
 * provider, AND the project must have at least one sync-active connected repo.
 * Returns `provider` so callers can render provider-aware copy ("Create
 * {GitHub|GitLab} issue") without re-querying.
 *
 * The returned `links` match the dispatcher's enqueue guard (active + not
 * frozen) so the UI never offers a repo the mutation would reject. Despite
 * the historical name, this hook is provider-neutral — it dispatches to the
 * correct provider's outbound adapter via the project's link.
 */
export function useGithubIssueEligibility(
  projectId: Id<"projects">,
  workspaceId: Id<"workspaces">,
): GithubIssueEligibility {
  const githubFeature = useQuery(
    api.integrations.core.entitlements.getWorkspaceFeature,
    { workspaceId, featureKey: GITHUB_FEATURE_KEY },
  );
  const gitlabFeature = useQuery(
    api.integrations.core.entitlements.getWorkspaceFeature,
    { workspaceId, featureKey: GITLAB_FEATURE_KEY },
  );
  const links = useQuery(api.integrations.core.links.linksForProject, {
    projectId,
  });

  const activeLinks = (links ?? []).filter(
    (l) => l.status === "active" && !l.pausedByBilling,
  );

  // A project carries at most one provider type (createLink rejects mixing),
  // so any active link's provider is the project's. Default to "github" for
  // the no-link case — eligibility is false there anyway, so the value
  // never reaches user-facing copy.
  const provider = activeLinks[0]?.provider ?? "github";
  const providerFeatureEnabled =
    provider === "gitlab"
      ? gitlabFeature?.enabled
      : githubFeature?.enabled;

  return {
    loading:
      githubFeature === undefined ||
      gitlabFeature === undefined ||
      links === undefined,
    eligible: Boolean(providerFeatureEnabled) && activeLinks.length > 0,
    provider,
    links: activeLinks,
  };
}
