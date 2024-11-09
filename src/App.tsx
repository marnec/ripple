import { Chat } from "@/Chat/Chat";
import { ChatIntro } from "@/Chat/ChatIntro";
import { Layout } from "@/Layout";
import { SignInForm } from "@/SignInForm";
import { UserMenu } from "@/components/UserMenu";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useState } from "react";
import { Id } from "../convex/_generated/dataModel";
import { Sidebar } from "@/components/Sidebar";

export default function App() {
  const user = useQuery(api.users.viewer);
  const [currentWorkspace, setCurrentWorkspace] = useState<string | null>(null);
  const [currentChannel, setCurrentChannel] = useState<string | null>(null);

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
              currentWorkspace={currentWorkspace ?? undefined}
              currentChannel={currentChannel ?? undefined}
              onWorkspaceSelect={setCurrentWorkspace}
              onChannelSelect={setCurrentChannel}
            />
            <div className="flex-1 flex flex-col">
              <ChatIntro />
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
