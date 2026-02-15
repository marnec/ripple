import { createContext, useContext } from "react";
import {
  useWorkspacePresence,
  type PresenceEntry,
} from "@/hooks/use-workspace-presence";

interface WorkspacePresenceContextValue {
  presenceMap: Map<string, PresenceEntry>;
  isConnected: boolean;
}

const WorkspacePresenceContext =
  createContext<WorkspacePresenceContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function usePresence() {
  const ctx = useContext(WorkspacePresenceContext);
  if (!ctx)
    throw new Error("usePresence must be used within WorkspacePresenceProvider");
  return ctx;
}

export function WorkspacePresenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useWorkspacePresence();
  return (
    <WorkspacePresenceContext.Provider value={value}>
      {children}
    </WorkspacePresenceContext.Provider>
  );
}
