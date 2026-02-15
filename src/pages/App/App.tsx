import { Layout } from "@/components/Layout";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useReadLocalStorage } from "usehooks-ts";
import { api } from "../../../convex/_generated/api";
import { FloatingCallWindow } from "../../components/FloatingCallWindow";
import { FollowModeIndicator } from "../../components/FollowModeIndicator";
import { ActiveCallProvider } from "../../contexts/ActiveCallContext";
import { FollowModeProvider } from "../../contexts/FollowModeContext";
import { WorkspacePresenceProvider } from "../../contexts/WorkspacePresenceContext";
import { SidebarProvider } from "../../components/ui/sidebar";
import { TooltipProvider } from "../../components/ui/tooltip";
import { UserContext } from "./UserContext";

export default function App() {
  const user = useQuery(api.users.viewer);
  const storedInviteId = useReadLocalStorage("inviteId");

  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    if (storedInviteId && typeof storedInviteId === "string") {
      void navigate(`/invite/${storedInviteId}`);
    }
  }, [user, storedInviteId, navigate]);

  return (
    <UserContext.Provider value={user}>
      <TooltipProvider>
        <Authenticated>
          <ActiveCallProvider>
            <WorkspacePresenceProvider>
              <FollowModeProvider>
                <SidebarProvider>
                <Layout />
                <FloatingCallWindow />
                <FollowModeIndicator />
                </SidebarProvider>
              </FollowModeProvider>
            </WorkspacePresenceProvider>
          </ActiveCallProvider>
        </Authenticated>
        <Unauthenticated >
          <Navigate to='/auth' replace></Navigate>
        </Unauthenticated>
      </TooltipProvider>
    </UserContext.Provider>
  );
}
