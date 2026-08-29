import { createContext, useContext } from "react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

type SidebarData = typeof api.workspaceSidebarData.get extends {
  _returnType: infer R;
}
  ? NonNullable<R>
  : never;

type SidebarContextValue = {
  data: SidebarData | undefined;
};

const WorkspaceSidebarContext = createContext<SidebarContextValue | undefined>(
  undefined,
);

export function WorkspaceSidebarProvider({
  workspaceId,
  children,
}: {
  workspaceId: Id<"workspaces">;
  children: React.ReactNode;
}) {
  // The query returns every conversation, dismissed ones flagged `isHidden`.
  // Revealing them is per-section client state now — it used to be one flag
  // here, driving a re-query, and shared by both sidebar sections, which is
  // why the Channels toggle was the only way to unhide a direct message.
  const data = useQuery(api.workspaceSidebarData.get, { workspaceId });

  return (
    <WorkspaceSidebarContext.Provider value={{ data: data ?? undefined }}>
      {children}
    </WorkspaceSidebarContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceSidebar() {
  const ctx = useContext(WorkspaceSidebarContext);
  return ctx?.data;
}

