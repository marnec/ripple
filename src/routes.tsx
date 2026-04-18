import { createBrowserRouter, Navigate } from "react-router-dom";
import { RouteErrorFallback } from "./components/RouteErrorFallback";
import App from "./pages/App/App";
import { ChannelDetails } from "./pages/App/Channel/ChannelDetails";
import { ChatContainer } from "./pages/App/Chat/ChatContainer";
import { Diagrams } from "./pages/App/Diagram/Diagrams";
import { Spreadsheets } from "./pages/App/Spreadsheet/Spreadsheets";
import { Documents } from "./pages/App/Document/Documents";
import { ProjectLayout } from "./pages/App/Project/ProjectLayout";
import { ProjectOverview } from "./pages/App/Project/ProjectOverview";
import { ProjectTasksPage } from "./pages/App/Project/ProjectTasksPage";
import { ProjectCycles } from "./pages/App/Project/ProjectCycles";
import { CycleDetail } from "./pages/App/Project/CycleDetail";
import { Projects } from "./pages/App/Project/Projects";
import { MyTasks } from "./pages/App/Project/MyTasks";
import { WorkspaceDetails } from "./pages/App/Workspace/WorkspaceDetails";
import { Workspaces } from "./pages/App/Workspace/Workspaces";
import { InviteAcceptPage } from "./pages/InviteAcceptPage";
import { LoginPage } from "./pages/LoginPage";
import { ShareEntryPage } from "./pages/Share/ShareEntryPage";
import { GuestResourceView } from "./pages/Share/GuestResourceView";
import { UserProfilePage } from "./pages/UserProfilePage";

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <App />,
      errorElement: <RouteErrorFallback />,
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
          errorElement: <RouteErrorFallback />,
          children: [
            {
              index: true,
              element: <WorkspaceDetails />,
            },
            {
              path: "settings",
              lazy: () =>
                import("./pages/App/Workspace/WorkspaceSettings").then((m) => ({
                  Component: m.WorkspaceSettings,
                })),
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
                  lazy: () =>
                    import("./pages/App/Channel/ChannelCall").then((m) => ({
                      Component: m.ChannelVideoCall,
                    })),
                },
                {
                  path: ":channelId/settings",
                  lazy: () =>
                    import("./pages/App/Channel/ChannelSettings").then((m) => ({
                      Component: m.ChannelSettings,
                    })),
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
                  element: <ProjectLayout />,
                  children: [
                    {
                      index: true,
                      element: <ProjectOverview />,
                    },
                    {
                      path: "tasks",
                      element: <ProjectTasksPage />,
                    },
                    {
                      path: "tasks/:taskId",
                      lazy: () =>
                        import("./pages/App/Project/TaskDetailPage").then(
                          (m) => ({ Component: m.TaskDetailPage }),
                        ),
                    },
                    {
                      path: "cycles",
                      element: <ProjectCycles />,
                    },
                    {
                      path: "cycles/:cycleId",
                      element: <CycleDetail />,
                    },
                    {
                      path: "calendar",
                      lazy: () =>
                        import("./pages/App/Project/ProjectCalendar").then(
                          (m) => ({ Component: m.ProjectCalendar }),
                        ),
                    },
                    {
                      path: "settings",
                      lazy: () =>
                        import("./pages/App/Project/ProjectSettings").then(
                          (m) => ({
                            Component: m.ProjectSettings,
                          }),
                        ),
                    },
                  ],
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
                  path: "import",
                  lazy: () =>
                    import("./pages/App/Document/DocumentImport").then((m) => ({
                      Component: m.DocumentImport,
                    })),
                },
                {
                  path: ":documentId",
                  lazy: () =>
                    import("./pages/App/Document/DocumentEditor").then((m) => ({
                      Component: m.DocumentEditorContainer,
                    })),
                },
                {
                  path: ":documentId/settings",
                  lazy: () =>
                    import("./pages/App/Document/DocumentSettings").then(
                      (m) => ({
                        Component: m.DocumentSettings,
                      }),
                    ),
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
                  lazy: () =>
                    import("./pages/App/Diagram/DiagramPage").then((m) => ({
                      Component: m.DiagramPage,
                    })),
                },
                {
                  path: ":diagramId/settings",
                  lazy: () =>
                    import("./pages/App/Diagram/DiagramSettings").then((m) => ({
                      Component: m.DiagramSettings,
                    })),
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
                  lazy: () =>
                    import("./pages/App/Spreadsheet/SpreadsheetPage").then(
                      (m) => ({
                        Component: m.SpreadsheetPage,
                      }),
                    ),
                },
                {
                  path: ":spreadsheetId/settings",
                  lazy: () =>
                    import("./pages/App/Spreadsheet/SpreadsheetSettings").then(
                      (m) => ({
                        Component: m.SpreadsheetSettings,
                      }),
                    ),
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
      path: "/share/:shareId",
      element: <ShareEntryPage />,
    },
    {
      path: "/share/:shareId/view",
      element: <GuestResourceView />,
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
