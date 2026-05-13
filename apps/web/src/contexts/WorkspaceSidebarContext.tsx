import { createContext, useCallback, useContext, useState } from "react";
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
  includeHidden: boolean;
  toggleIncludeHidden: () => void;
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
  // Whether the "Show N hidden" toggle is engaged. Local UI state — not
  // persisted; users surfacing hidden channels is a transient action ("let me
  // find the channel I hid"), not a setting.
  const [includeHidden, setIncludeHidden] = useState(false);
  const toggleIncludeHidden = useCallback(
    () => setIncludeHidden((prev) => !prev),
    [],
  );

  const data = useQuery(api.workspaceSidebarData.get, {
    workspaceId,
    includeHidden,
  });

  return (
    <WorkspaceSidebarContext.Provider
      value={{ data: data ?? undefined, includeHidden, toggleIncludeHidden }}
    >
      {children}
    </WorkspaceSidebarContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceSidebar() {
  const ctx = useContext(WorkspaceSidebarContext);
  return ctx?.data;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceSidebarHiddenToggle() {
  const ctx = useContext(WorkspaceSidebarContext);
  return {
    includeHidden: ctx?.includeHidden ?? false,
    toggleIncludeHidden: ctx?.toggleIncludeHidden ?? (() => {}),
  };
}
