import { createBrowserRouter, Navigate } from "react-router-dom";
import App from "./pages/App/App";
import { ChannelVideoCall } from "./pages/App/Channel/ChannelCall";
import { ChannelDetails } from "./pages/App/Channel/ChannelDetails";
import { ChannelSettings } from "./pages/App/Channel/ChannelSettings";
import { ChatContainer } from "./pages/App/Chat/ChatContainer";
import { DiagramPage } from "./pages/App/Diagram/DiagramPage";
import { Diagrams } from "./pages/App/Diagram/Diagrams";
import { DiagramSettings } from "./pages/App/Diagram/DiagramSettings";
import { SpreadsheetPage } from "./pages/App/Spreadsheet/SpreadsheetPage";
import { Spreadsheets } from "./pages/App/Spreadsheet/Spreadsheets";
import { SpreadsheetSettings } from "./pages/App/Spreadsheet/SpreadsheetSettings";
import { DocumentEditorContainer } from "./pages/App/Document/DocumentEditor";
import { Documents } from "./pages/App/Document/Documents";
import { DocumentSettings } from "./pages/App/Document/DocumentSettings";
import { ProjectDetails } from "./pages/App/Project/ProjectDetails";
import { Projects } from "./pages/App/Project/Projects";
import { ProjectSettings } from "./pages/App/Project/ProjectSettings";
import { MyTasks } from "./pages/App/Project/MyTasks";
import { TaskDetailPage } from "./pages/App/Project/TaskDetailPage";
import { WorkspaceDetails } from "./pages/App/Workspace/WorkspaceDetails";
import { Workspaces } from "./pages/App/Workspace/Workspaces";
import { WorkspaceSettings } from "./pages/App/Workspace/WorkspaceSettings";
import { InviteAcceptPage } from "./pages/InviteAcceptPage";
import { LoginPage } from "./pages/LoginPage";
import { UserProfilePage } from "./pages/UserProfilePage";

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <App />,
      children: [
        {
          index: true,
          element: <Navigate to="/workspaces" replace />,
        },
        {
          path: "workspaces",
          element: <Workspaces />,
        },
        {
          path: "workspaces/:workspaceId",
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
              path: "my-tasks",
              element: <MyTasks />,
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
              path: "projects",
              children: [
                {
                  index: true,
                  element: <Projects />,
                },
                {
                  path: ":projectId",
                  element: <ProjectDetails />,
                },
                {
                  path: ":projectId/tasks/:taskId",
                  element: <TaskDetailPage />,
                },
                {
                  path: ":projectId/settings",
                  element: <ProjectSettings />,
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
                {
                  path: ":diagramId/settings",
                  element: <DiagramSettings />,
                },
              ],
            },
            {
              path: "spreadsheets",
              children: [
                {
                  index: true,
                  element: <Spreadsheets />,
                },
                {
                  path: ":spreadsheetId",
                  element: <SpreadsheetPage />,
                },
                {
                  path: ":spreadsheetId/settings",
                  element: <SpreadsheetSettings />,
                },
              ],
            },
          ],
        },
        {
          path: "profile",
          element: <UserProfilePage />,
        },
      ],
    },
    {
      path: "/invite/:inviteId",
      element: <InviteAcceptPage />,
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
