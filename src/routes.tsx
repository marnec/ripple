import { createBrowserRouter } from "react-router-dom";
import App from "./pages/App/App";
import { ChannelVideoCall } from "./pages/App/Channel/ChannelCall";
import { ChannelSettings } from "./pages/App/Channel/ChannelSettings";
import { ChatContainer } from "./pages/App/Chat/ChatContainer";
import { DocumentEditorContainer } from "./pages/App/Document/DocumentEditor";
import { Documents } from "./pages/App/Document/Documents";
import { WorkspaceDetails } from "./pages/App/Workspace/WorkspaceDetails";
import { WorkspaceSettings } from "./pages/App/Workspace/WorkspaceSettings";
import { InviteAcceptPage } from "./pages/InviteAcceptPage";
import { LoginPage } from "./pages/LoginPage";
import { UserProfilePage } from "./pages/UserProfilePage";

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <App />,
    },
    {
      element: <App />,
      children: [
        {
          path: "/workspace",
          element: <div>hellop</div>,
        },
        {
          path: "/workspace/:workspaceId",
          children: [
            {
              index: true,
              element: <WorkspaceDetails />,
            },
            {
              path: "settings",
              element: <WorkspaceSettings />,
            },
            {
              path: "channel",
              children: [
                {
                  path: ":channelId",
                  element: <ChatContainer />,
                },
                {
                  path: ":channelId/videocall",
                  element: <ChannelVideoCall />,
                },
                {
                  path: ":channelId/settings",
                  element: <ChannelSettings />,
                },
              ],
            },
            {
              path: "document",
              children: [
                {
                  index: true,
                  element: <Documents />,
                },
                {
                  path: ":documentId",
                  element: <DocumentEditorContainer />,
                },
              ],
            },
          ],
        },
        {
          path: "invite",
          element: <InviteAcceptPage />,
        },
        {
          path: "profile",
          element: <UserProfilePage />,
        },
      ],
    },
    {
      path: "/auth",
      element: <LoginPage />,
    },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  },
);
