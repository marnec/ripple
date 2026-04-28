import { createBrowserRouter, Navigate } from "react-router-dom";
import { RouteErrorFallback } from "./components/RouteErrorFallback";

export const router = createBrowserRouter(
  [
    {
      path: "/",
      lazy: () =>
        import("./pages/App/App").then((m) => ({ Component: m.default })),
      errorElement: <RouteErrorFallback />,
      children: [
        {
          index: true,
          element: <Navigate to="/workspaces" replace />,
        },
        {
          path: "workspaces",
          lazy: () =>
            import("./pages/App/Workspace/Workspaces").then((m) => ({
              Component: m.Workspaces,
            })),
        },
        {
          path: "workspaces/:workspaceId",
          errorElement: <RouteErrorFallback />,
          children: [
            {
              index: true,
              lazy: () =>
                import("./pages/App/Workspace/WorkspaceDetails").then((m) => ({
                  Component: m.WorkspaceDetails,
                })),
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
              lazy: () =>
                import("./pages/App/Project/MyTasks").then((m) => ({
                  Component: m.MyTasks,
                })),
            },
            {
              path: "channels",
              children: [
                {
                  index: true,
                  lazy: () =>
                    import("./pages/App/Channel/ChannelDetails").then((m) => ({
                      Component: m.ChannelDetails,
                    })),
                },
                {
                  path: ":channelId",
                  lazy: () =>
                    import("./pages/App/Chat/ChatContainer").then((m) => ({
                      Component: m.ChatContainer,
                    })),
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
                  lazy: () =>
                    import("./pages/App/Project/Projects").then((m) => ({
                      Component: m.Projects,
                    })),
                },
                {
                  // Task detail has its own toolbar (delete / tags / title /
                  // code / back-to-project), so it lives outside ProjectLayout
                  // to avoid showing the project's header + tabs on top.
                  path: ":projectId/tasks/:taskId",
                  lazy: () =>
                    import("./pages/App/Project/TaskDetailPage").then((m) => ({
                      Component: m.TaskDetailPage,
                    })),
                },
                {
                  path: ":projectId",
                  lazy: () =>
                    import("./pages/App/Project/ProjectLayout").then((m) => ({
                      Component: m.ProjectLayout,
                    })),
                  children: [
                    {
                      index: true,
                      lazy: () =>
                        import("./pages/App/Project/ProjectOverview").then(
                          (m) => ({ Component: m.ProjectOverview }),
                        ),
                    },
                    {
                      path: "tasks",
                      lazy: () =>
                        import("./pages/App/Project/ProjectTasksPage").then(
                          (m) => ({ Component: m.ProjectTasksPage }),
                        ),
                    },
                    {
                      path: "cycles",
                      lazy: () =>
                        import("./pages/App/Project/ProjectCycles").then(
                          (m) => ({ Component: m.ProjectCycles }),
                        ),
                    },
                    {
                      path: "cycles/:cycleId",
                      lazy: () =>
                        import("./pages/App/Project/CycleDetail").then(
                          (m) => ({ Component: m.CycleDetail }),
                        ),
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
                  lazy: () =>
                    import("./pages/App/Document/Documents").then((m) => ({
                      Component: m.Documents,
                    })),
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
                  lazy: () =>
                    import("./pages/App/Diagram/Diagrams").then((m) => ({
                      Component: m.Diagrams,
                    })),
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
                  lazy: () =>
                    import("./pages/App/Spreadsheet/Spreadsheets").then((m) => ({
                      Component: m.Spreadsheets,
                    })),
                },
                {
                  path: "import",
                  lazy: () =>
                    import("./pages/App/Spreadsheet/SpreadsheetImport").then(
                      (m) => ({
                        Component: m.SpreadsheetImport,
                      }),
                    ),
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
          lazy: () =>
            import("./pages/UserProfilePage").then((m) => ({
              Component: m.UserProfilePage,
            })),
        },
      ],
    },
    {
      path: "/invite/:inviteId",
      lazy: () =>
        import("./pages/InviteAcceptPage").then((m) => ({
          Component: m.InviteAcceptPage,
        })),
    },
    {
      path: "/share/:shareId",
      lazy: () =>
        import("./pages/Share/ShareEntryPage").then((m) => ({
          Component: m.ShareEntryPage,
        })),
    },
    {
      path: "/share/:shareId/view",
      lazy: () =>
        import("./pages/Share/GuestResourceView").then((m) => ({
          Component: m.GuestResourceView,
        })),
    },
    {
      path: "/auth",
      lazy: () =>
        import("./pages/LoginPage").then((m) => ({
          Component: m.LoginPage,
        })),
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
