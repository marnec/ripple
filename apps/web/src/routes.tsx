import { createBrowserRouter, Navigate, useParams } from "react-router-dom";
import { RouteErrorFallback } from "./components/RouteErrorFallback";

/**
 * Bridge for the legacy `/calendar/events/:eventId/videocall` URL into
 * the new flat `/events/:eventId/videocall` shape. `useParams` reads
 * eventId from the matched route so the redirect carries the id along
 * rather than dropping the user on an empty list. Only client-generated
 * URLs ever hit this path — server notifications use `?event=<id>` on
 * the calendar tab — but the bridge keeps any pinned tabs working.
 */
// eslint-disable-next-line react-refresh/only-export-components -- routes.tsx exports `router` (non-component) by design; a local component bridge alongside it doesn't break runtime, only fast-refresh edit-the-route hot reload
function RedirectToFlatVideocall() {
  const { workspaceId, eventId } = useParams<{
    workspaceId?: string;
    eventId?: string;
  }>();
  if (!workspaceId || !eventId) {
    return <Navigate to="/workspaces" replace />;
  }
  return (
    <Navigate
      to={`/workspaces/${workspaceId}/events/${eventId}/videocall`}
      replace
    />
  );
}

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
              // Role-aware: admins see the workspace summary, members are
              // redirected to their personal dashboard. See WorkspaceLanding.
              index: true,
              lazy: () =>
                import("./pages/App/Workspace/WorkspaceLanding").then((m) => ({
                  Component: m.WorkspaceLanding,
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
              // No real tag-management surface yet — the dashboard's Tags
              // counter links here as a placeholder so the card isn't a
              // dead pixel.
              path: "tags",
              lazy: () =>
                import("./pages/App/Workspace/TagsEasterEgg").then((m) => ({
                  Component: m.TagsEasterEgg,
                })),
            },
            {
              // Replaces the standalone /my-tasks route. The dashboard layout
              // owns the header + tab selector; the My Tasks tab reuses the
              // existing MyTasks page body.
              path: "dashboard",
              lazy: () =>
                import("./pages/App/Dashboard/DashboardLayout").then((m) => ({
                  Component: m.DashboardLayout,
                })),
              children: [
                {
                  index: true,
                  lazy: () =>
                    import("./pages/App/Dashboard/MyTasksTab").then((m) => ({
                      Component: m.MyTasksTab,
                    })),
                },
                {
                  path: "calendar",
                  lazy: () =>
                    import("./pages/App/Dashboard/MyCalendarTab").then((m) => ({
                      Component: m.MyCalendarTab,
                    })),
                },
              ],
            },
            {
              // Calendar event surfaces — flat under `/events/...` so
              // every breadcrumb segment lands somewhere real:
              //   /events            → redirect to dashboard calendar tab
              //   /events/:id        → full event page
              //   /events/:id/videocall → authenticated event call
              // The calendar tab itself stays at /dashboard/calendar
              // (it's a UI surface, not the resource home — same way
              // tasks live under /projects/:projectId/tasks/:taskId
              // rather than under any specific tab).
              path: "events",
              children: [
                {
                  // Bare /events has no list page yet; redirect to the
                  // calendar tab so the breadcrumb's "Events" segment
                  // doesn't dead-end. Replace so the redirected URL
                  // doesn't pollute history.
                  index: true,
                  element: <Navigate to="../dashboard/calendar" replace />,
                },
                {
                  path: ":eventId",
                  lazy: () =>
                    import("./pages/App/Calendar/EventDetailPage").then((m) => ({
                      Component: m.EventDetailPage,
                    })),
                },
                {
                  path: ":eventId/videocall",
                  lazy: () =>
                    import("./pages/App/Calendar/EventVideoCall").then((m) => ({
                      Component: m.EventVideoCall,
                    })),
                },
              ],
            },
            {
              // Back-compat: any in-flight URL pointing at the old
              // `/calendar/events/:id/videocall` (only generated
              // client-side from EventDetailSheet — emails use the
              // `?event=<id>` query param style instead) gets redirected
              // to the new flat path. Safe to remove once we're
              // confident no bookmark or in-flight tab still references
              // the old shape.
              path: "calendar/events/:eventId/videocall",
              element: <RedirectToFlatVideocall />,
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
                  path: "import",
                  lazy: () =>
                    import("./pages/App/Diagram/DiagramImport").then((m) => ({
                      Component: m.DiagramImport,
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
);
