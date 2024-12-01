import { Layout } from "@/Layout";
import { SignInForm } from "@/SignInForm";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import React, { useEffect } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { api } from "../convex/_generated/api";
import { TooltipProvider } from "./components/ui/tooltip";
import { User } from "@auth/core/types";

export const UserContext = React.createContext<User | null | undefined>(undefined);

export default function App() {
  const user = useQuery(api.users.viewer);
  const { workspaceId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (workspaceId) {
      // Validate that workspace exists and user has access
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!user) return;
    const storedInviteId = localStorage.getItem("inviteId");
    if (storedInviteId) navigate(`/invite/${storedInviteId}`);
  }, [user]);

  return (
    <TooltipProvider>
      <UserContext.Provider value={user}>
        <Layout>
          <>
            <Authenticated>
              <div className="flex h-full">
                <Outlet />
              </div>
            </Authenticated>
            <Unauthenticated>
              <SignInForm />
            </Unauthenticated>
          </>
        </Layout>
      </UserContext.Provider>
    </TooltipProvider>
  );
}
