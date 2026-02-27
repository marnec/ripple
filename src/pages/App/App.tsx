import { Layout } from "@/components/Layout";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useReadLocalStorage } from "usehooks-ts";

const viewerRef = makeFunctionReference<"query">("users:viewer");
import { FloatingCallWindow } from "../../components/FloatingCallWindow";
import { ActiveCallProvider } from "../../contexts/ActiveCallContext";
import { FollowModeProvider } from "../../contexts/FollowModeContext";
import { WorkspacePresenceProvider } from "../../contexts/WorkspacePresenceContext";
import { SidebarProvider } from "../../components/ui/sidebar";
import { TooltipProvider } from "../../components/ui/tooltip";
import { UserContext } from "./UserContext";

export default function App() {
  const user = useQuery(viewerRef);
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
