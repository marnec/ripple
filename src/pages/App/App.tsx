import { Layout } from "@/components/Layout";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useReadLocalStorage } from "usehooks-ts";
import { api } from "../../../convex/_generated/api";
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
          <SidebarProvider>
            <Layout />
          </SidebarProvider>
        </Authenticated>
        <Unauthenticated >
          <Navigate to='/auth' replace></Navigate>
        </Unauthenticated>
      </TooltipProvider>
    </UserContext.Provider>
  );
}
