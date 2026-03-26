import { createContext, useContext } from "react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type SidebarData = typeof api.workspaceSidebarData.get extends {
  _returnType: infer R;
}
  ? NonNullable<R>
  : never;

const WorkspaceSidebarContext = createContext<SidebarData | undefined>(
  undefined,
);

export function WorkspaceSidebarProvider({
  workspaceId,
  children,
}: {
  workspaceId: Id<"workspaces">;
  children: React.ReactNode;
}) {
  const data = useQuery(api.workspaceSidebarData.get, { workspaceId });
  return (
    <WorkspaceSidebarContext.Provider value={data ?? undefined}>
      {children}
    </WorkspaceSidebarContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceSidebar() {
  return useContext(WorkspaceSidebarContext);
}
