import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { QueryParams } from "@ripple/shared/types/routes";
import { WorkspaceDetails } from "./WorkspaceDetails";

/**
 * Role-aware workspace landing.
 *
 * Admins see the workspace summary (graph + activity timeline); regular
 * members are redirected to their personal dashboard. Members can still
 * reach the summary via direct URL — non-admins just don't *land* on it.
 *
 * Loading state renders nothing (project rule: no skeleton loaders) so the
 * eventual fade-in feels seamless.
 */
export function WorkspaceLanding() {
  const { workspaceId } = useParams<QueryParams>();
  const role = useQuery(
    api.workspaceMembers.myRole,
    workspaceId ? { workspaceId } : "skip",
  );

  if (!workspaceId) return <Navigate to="/workspaces" replace />;
  if (role === undefined) return null;
  if (role === null) return <Navigate to="/workspaces" replace />;
  if (role === "admin") return <WorkspaceDetails />;
  return <Navigate to="dashboard" replace />;
}
