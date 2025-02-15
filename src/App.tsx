import { Layout } from "@/Layout";
import { User } from "@auth/core/types";
import { useQuery } from "convex/react";
import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../convex/_generated/api";
import { SidebarProvider } from "./components/ui/sidebar";
import { TooltipProvider } from "./components/ui/tooltip";

export const UserContext = React.createContext<User | null | undefined>(undefined);

export default function App() {
  const user = useQuery(api.users.viewer);

  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    const storedInviteId = localStorage.getItem("inviteId");
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
