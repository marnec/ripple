import { createContext, useContext } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type MembersData = typeof api.workspaceMembers.membersByWorkspace extends {
  _returnType: infer R;
}
  ? NonNullable<R>
  : never;

const WorkspaceMembersContext = createContext<MembersData | undefined>(
  undefined,
);

export function WorkspaceMembersProvider({
  workspaceId,
  children,
}: {
  workspaceId: Id<"workspaces">;
  children: React.ReactNode;
}) {
  const data = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  return (
    <WorkspaceMembersContext.Provider value={data ?? undefined}>
      {children}
    </WorkspaceMembersContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceMembers() {
  return useContext(WorkspaceMembersContext);
}
