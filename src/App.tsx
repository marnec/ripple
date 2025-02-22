import { Layout } from "@/Layout";
import { User } from "@auth/core/types";
import { useQuery } from "convex/react";
import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useReadLocalStorage } from "usehooks-ts";
import { api } from "../convex/_generated/api";
import { SidebarProvider } from "./components/ui/sidebar";
import { TooltipProvider } from "./components/ui/tooltip";

export const UserContext = React.createContext<User | null | undefined>(undefined);

export default function App() {
  const user = useQuery(api.users.viewer);
  const storedInviteId = useReadLocalStorage("inviteId");

  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    if (storedInviteId) navigate(`/invite/${storedInviteId}`);
  }, [user]);

  return (
    <TooltipProvider>
      <SidebarProvider>
        <UserContext.Provider value={user}>
          <Layout />
        </UserContext.Provider>
      </SidebarProvider>
    </TooltipProvider>
  );
}
