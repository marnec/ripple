import { Layout } from "@/components/Layout";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { clearCollaborationTokenCache } from "@/lib/collaboration-token-cache";
import { clearQueryCache } from "@/lib/query-cache";
import { useAuthToken } from "@convex-dev/auth/react";
import { Unauthenticated, useConvexAuth } from "convex/react";
import React, { Suspense, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useReadLocalStorage } from "usehooks-ts";
import { api } from "@convex/_generated/api";
import { ActiveCallProvider } from "../../contexts/ActiveCallContext";

const LazyFloatingCallWindow = React.lazy(() =>
  import("../../components/FloatingCallWindow").then((m) => ({
    default: m.FloatingCallWindow,
  })),
);
import { FollowModeProvider } from "../../contexts/FollowModeContext";
import { FocusModeProvider } from "../../contexts/FocusModeContext";
import { WorkspacePresenceProvider } from "../../contexts/WorkspacePresenceContext";
import { SidebarProvider } from "../../components/ui/sidebar";
import { TooltipProvider } from "@ripple/ui/components/tooltip";
import { UserContext } from "./UserContext";

/**
 * Where `<Authenticated>` would go.
 *
 * `<Authenticated>` opens only once the server has confirmed the stored
 * token, and on a cold load with no network that confirmation never comes —
 * so a device holding a valid session and a cached sidebar showed a blank
 * page. This opens on the stored token alone while the browser reports no
 * network: everything under it renders from the device's own copies, flagged
 * not live, and the moment the network is back the normal confirmation
 * either keeps it open or — token revoked — closes it and `<Unauthenticated>`
 * takes over. Nothing new is exposed: the copies were already on the device.
 *
 * "Browser reports no network" and not "server unreachable": the latter is
 * exactly the case where a revoked token must keep waiting for its verdict.
 */
function SessionGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const token = useAuthToken();
  const online = useOnlineStatus();
  const open = isAuthenticated || (isLoading && token !== null && !online);
  return open ? <>{children}</> : null;
}

export default function App() {
  // Cached: `useViewer()` is what every page asks for the signed-in user, and
  // offline the query behind it never answers.
  const user = useCachedQuery(api.users.viewer, {}).value;
  const storedInviteId = useReadLocalStorage("inviteId");

  const navigate = useNavigate();
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();

  // Collaboration tokens carry the signed-in user's identity, so the session
  // ending has to empty the cache — otherwise the next person to sign in on
  // this tab could connect to a room as the previous one. Watched here rather
  // than inside <Authenticated>, whose children unmount on sign-out and so
  // never observe the transition.
  useEffect(() => {
    if (!isAuthenticated) clearCollaborationTokenCache();
  }, [isAuthenticated]);

  // Same reasoning for the answers kept on the device: they belong to the
  // session, and the next person to sign in on this browser must not see
  // them. Gated on the verdict, not on "not yet authenticated" — on a cold
  // load the verdict is pending and the cache is the whole point.
  useEffect(() => {
    if (!authLoading && !isAuthenticated) void clearQueryCache();
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!user) return;
    if (storedInviteId && typeof storedInviteId === "string") {
      void navigate(`/invite/${storedInviteId}`);
    }
  }, [user, storedInviteId, navigate]);

  return (
    <UserContext.Provider value={user}>
      <TooltipProvider>
        <SessionGate>
          <ActiveCallProvider>
            <WorkspacePresenceProvider>
              <FollowModeProvider>
                <FocusModeProvider>
                <SidebarProvider>
                <Layout />
                <Suspense fallback={null}>
                  <LazyFloatingCallWindow />
                </Suspense>
                </SidebarProvider>
                </FocusModeProvider>
              </FollowModeProvider>
            </WorkspacePresenceProvider>
          </ActiveCallProvider>
        </SessionGate>
        <Unauthenticated >
          <Navigate to='/auth' replace></Navigate>
        </Unauthenticated>
      </TooltipProvider>
    </UserContext.Provider>
  );
}
