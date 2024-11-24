import { Chat } from "@/Chat/Chat";
import { ChatIntro } from "@/Chat/ChatIntro";
import { Layout } from "@/Layout";
import { SignInForm } from "@/SignInForm";
import { UserMenu } from "@/components/UserMenu";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useEffect, useState } from "react";
import { Id } from "../convex/_generated/dataModel";
import { Sidebar } from "@/components/Sidebar";
import { useNavigate, useParams } from "react-router-dom";

export default function App() {
  const user = useQuery(api.users.viewer);
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const [currentChannel, setCurrentChannel] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceId) {
      // Validate that workspace exists and user has access
      // This could be done with a separate query
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!user) return;
    const storedInviteId = localStorage.getItem("inviteId");
    if (storedInviteId) navigate(`/invite/${storedInviteId}`);
  }, [user]);

  const handleWorkspaceSelect = (id: string) => {
    navigate(`/workspaces/${id}`);
  };

  return (
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
            <Sidebar
              currentWorkspace={workspaceId ?? undefined}
              currentChannel={currentChannel ?? undefined}
              onWorkspaceSelect={handleWorkspaceSelect}
              onChannelSelect={setCurrentChannel}
            />
            <div className="flex-1 flex flex-col">
              <ChatIntro
                workspaceId={workspaceId ?? undefined}
                channelId={currentChannel ?? undefined}
              />
              {currentChannel ? (
                <Chat
                  viewer={(user ?? {})._id!}
                  channelId={currentChannel as Id<"channels">}
                />
              ) : (
                <div className="flex items-center justify-center flex-1 text-muted-foreground">
                  Select or create a workspace to start chatting
                </div>
              )}
            </div>
          </div>
        </Authenticated>
        <Unauthenticated>
          <SignInForm />
        </Unauthenticated>
      </>
    </Layout>
  );
}
