import { createBrowserRouter } from "react-router-dom";
import App from "./pages/App/App";
import { ChannelVideoCall } from "./pages/App/Channel/ChannelCall";
import { ChannelSettings } from "./pages/App/Channel/ChannelSettings";
import { ChatContainer } from "./pages/App/Chat/ChatContainer";
import { DocumentEditorContainer } from "./pages/App/Document/DocumentEditor";
import { Documents } from "./pages/App/Document/Documents";
import { ExcalidrawEditor } from "./pages/App/Diagram/ExcalidrawEditor";
import { Diagrams } from "./pages/App/Diagram/Diagrams";
import { WorkspaceDetails } from "./pages/App/Workspace/WorkspaceDetails";
import { WorkspaceSettings } from "./pages/App/Workspace/WorkspaceSettings";
import { InviteAcceptPage } from "./pages/InviteAcceptPage";
import { LoginPage } from "./pages/LoginPage";
import { UserProfilePage } from "./pages/UserProfilePage";
import { DiagramPage } from "./pages/App/Diagram/DiagramPage";
import { Workspaces } from "./pages/App/Workspace/Workspaces";
import { ChannelDetails } from "./pages/App/Channel/ChannelDetails";
import { DocumentSettings } from "./pages/App/Document/DocumentSettings";

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
          path: "/workspaces",
          element: <Workspaces />,
        },
        {
          path: "/workspaces/:workspaceId",
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
              path: "channels",
              children: [
                {
                  index: true,
                  element: <ChannelDetails />,
                },
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
              path: "documents",
              children: [
                {
                  index: true,
                  element: <Documents />,
                },
                {
                  path: ":documentId",
                  element: <DocumentEditorContainer />,
                },
                {
                  path: ":documentId/settings",
                  element: <DocumentSettings />,
                },
              ],
            },
            {
              path: "diagrams",
              children: [
                {
                  index: true,
                  element: <Diagrams />,
                },
                {
                  path: ":diagramId",
                  element: <DiagramPage />,
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
