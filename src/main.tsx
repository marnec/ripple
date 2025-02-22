import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App.tsx";
import { ChannelVideoCall } from "./components/Channel/ChannelCall.tsx";
import { ChatContainer } from "./components/Chat/ChatContainer.tsx";
import { DocumentEditorContainer } from "./components/Document/DocumentEditor.tsx";
import { Documents } from "./components/Document/Documents.tsx";
import { Toaster } from "./components/ui/toaster.tsx";
import { WorkspaceDetails } from "./components/Workspace/WorkspaceDetails.tsx";
import { WorkspaceSettings } from "./components/Workspace/WorkspaceSettings.tsx";
import "./index.css";
import { InviteAcceptPage } from "./pages/InviteAcceptPage.tsx";
import { UserProfilePage } from "./pages/UserProfilePage.tsx";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

window.addEventListener("load", () => {
  if ("serviceWorker" in navigator && "PushManager" in window) {
    navigator.serviceWorker
      .register("/service-worker.js")
      .catch((error) => {
        console.error("An error occurred while registering the service worker.");
        console.error(error);
      });
  } else {
    console.error("Browser does not support service workers or push messages.");
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, interactive-widget=resizes-content"
    />
    <ThemeProvider attribute="class">
      <Toaster />
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/workspace/:workspaceId/" element={<App />}>
              <Route index element={<WorkspaceDetails />} />
              <Route path="settings" element={<WorkspaceSettings />} />
              <Route path="channel/:channelId" element={<ChatContainer />} />
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
