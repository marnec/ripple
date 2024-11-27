import { ConvexAuthProvider } from "@convex-dev/auth/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { ConvexReactClient } from "convex/react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.tsx";
import "./index.css";
import { InviteAcceptPage } from "./pages/InviteAcceptPage.tsx";
import { UserProfilePage } from "./pages/UserProfilePage.tsx";
import { WorkspaceDetails } from "./components/WorkspaceDetails.tsx";
import { ChatLayout } from "./Chat/ChatLayout.tsx";
import { WorkspaceSettings } from "./components/WorkspaceSettings.tsx";


const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class">
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/workspaces/:workspaceId/" element={<App />} >
              <Route index element={<WorkspaceDetails/>} />
              <Route path="settings" element={<WorkspaceSettings />} />
              <Route path="channel/:channelId" element={<ChatLayout />} />
            </Route>

            <Route path="/invite/:inviteId" element={<InviteAcceptPage />} />
            <Route path="/profile" element={<UserProfilePage />} />
          </Routes>
        </BrowserRouter>
      </ConvexAuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
