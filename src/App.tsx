import { Layout } from "@/Layout";
import { SignInForm } from "@/SignInForm";
import { Sidebar } from "@/components/Sidebar";
import { UserMenu } from "@/components/UserMenu";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { useEffect } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { api } from "../convex/_generated/api";
import { TooltipProvider } from "./components/ui/tooltip";

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
      <Layout
        menu={
          <Authenticated>
            <UserMenu>{user?.name ?? user?.email}</UserMenu>
          </Authenticated>
        }
      >
        <>
          <Authenticated>
            <div className="flex h-full">
              <Sidebar />
              <Outlet />
            </div>
          </Authenticated>
          <Unauthenticated>
            <SignInForm />
          </Unauthenticated>
        </>
      </Layout>
    </TooltipProvider>
  );
}
