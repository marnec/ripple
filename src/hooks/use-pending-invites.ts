import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function usePendingInvites() {
  return useQuery(api.workspaceInvites.listByEmail) ?? [];
}
