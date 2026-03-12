import { FavoriteButton } from "@/components/FavoriteButton";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { LayoutDashboard, ListTodo, RefreshCw, Settings } from "lucide-react";
import { useParams, NavLink, Outlet } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useRecordVisit } from "@/hooks/use-record-visit";

export function ProjectLayout() {
  const { workspaceId, projectId } = useParams<QueryParams>();

  if (!workspaceId || !projectId) {
    return <SomethingWentWrong />;
  }

  return (
    <ProjectLayoutContent
      workspaceId={workspaceId}
      projectId={projectId}
    />
  );
}

const tabs = [
  { label: "Overview", icon: LayoutDashboard, to: ".", end: true },
  { label: "Tasks", icon: ListTodo, to: "tasks", end: false },
  { label: "Cycles", icon: RefreshCw, to: "cycles", end: false },
  { label: "Settings", icon: Settings, to: "settings", end: false },
];

function ProjectLayoutContent({
  workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const project = useQuery(api.projects.get, { id: projectId });
  useRecordVisit(workspaceId, "project", projectId, project?.name);

  if (project === null) {
    return <SomethingWentWrong />;
  }

  const isLoading = project === undefined;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Project header with inline tabs */}
      <div className="flex items-center justify-between gap-4 px-3 border-b min-h-11">
        <div className="flex items-center gap-2 min-w-0">
          <FavoriteButton
            resourceType="project"
            resourceId={projectId}
            workspaceId={workspaceId}
          />
          {!isLoading && (
            <div className="flex items-center gap-2 min-w-0 animate-in fade-in duration-200">
              <h1 className="text-lg font-semibold truncate">{project.name}</h1>
              {project.color && (
                <span className={`w-2 h-2 rounded-full ${project.color} shrink-0`} />
              )}
            </div>
          )}
        </div>

        <div className="inline-flex h-8 items-center justify-center rounded-lg bg-muted p-1 shrink-0">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              viewTransition
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all",
                  isActive
                    ? "bg-background text-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                )
              }
            >
              <tab.icon className="size-4 sm:hidden" />
              <span className="hidden sm:inline">{tab.label}</span>
            </NavLink>
          ))}
        </div>
      </div>

      {/* Page content */}
      <div className="flex-1 flex flex-col min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
