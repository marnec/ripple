import { FavoriteButton } from "@/components/FavoriteButton";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { useParams, NavLink, Outlet } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

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
  { label: "Overview", to: ".", end: true },
  { label: "Tasks", to: "tasks", end: false },
  { label: "Cycles", to: "cycles", end: false },
  { label: "Settings", to: "settings", end: false },
];

function ProjectLayoutContent({
  workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const project = useQuery(api.projects.get, { id: projectId });

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
          {isLoading ? (
            <div className="h-5 w-40 bg-muted animate-pulse rounded" />
          ) : (
            <>
              <h1 className="text-sm font-semibold truncate">{project.name}</h1>
              {project.color && (
                <span className={`w-2 h-2 rounded-full ${project.color} shrink-0`} />
              )}
            </>
          )}
        </div>

        <div className="inline-flex h-8 items-center justify-center rounded-lg bg-muted p-1 shrink-0">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all",
                  isActive
                    ? "bg-background text-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                )
              }
            >
              {tab.label}
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
