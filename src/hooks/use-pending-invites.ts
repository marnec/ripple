import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function usePendingInvites(enabled = true) {
  return useQuery(api.workspaceInvites.listByEmail, enabled ? {} : "skip") ?? [];
}
