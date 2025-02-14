import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { makeUseQueryWithStatus } from "convex-helpers/react";
import { ConvexReactClient, useQueries } from "convex/react";
import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App.tsx";
import { ChannelVideoCall } from "./components/Channel/ChannelCall.tsx";
import { ChatLayout } from "./components/Chat/ChatLayout.tsx";
import { DocumentEditorContainer } from "./components/Document/DocumentEditor.tsx";
import { Toaster } from "./components/ui/toaster.tsx";
import { WorkspaceDetails } from "./components/Workspace/WorkspaceDetails.tsx";
import { WorkspaceSettings } from "./components/Workspace/WorkspaceSettings.tsx";
import "./index.css";
import { InviteAcceptPage } from "./pages/InviteAcceptPage.tsx";
import { UserProfilePage } from "./pages/UserProfilePage.tsx";
import { Documents } from "./components/Document/Documents.tsx";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

export const useQueryWithStatus = makeUseQueryWithStatus(useQueries);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class">
      <Toaster />
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/workspace/:workspaceId/" element={<App />}>
              <Route index element={<WorkspaceDetails />} />
              <Route path="settings" element={<WorkspaceSettings />} />
              <Route path="channel/:channelId" element={<ChatLayout />} />
              <Route path="channel/:channelId/videocall" element={<ChannelVideoCall />} />
              <Route path="document" element={<Documents />} />
              <Route path="document/:documentId" element={<DocumentEditorContainer />} />
            </Route>

            <Route path="/invite/:inviteId" element={<InviteAcceptPage />} />
            <Route path="/profile" element={<UserProfilePage />} />
          </Routes>
        </BrowserRouter>
      </ConvexAuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
