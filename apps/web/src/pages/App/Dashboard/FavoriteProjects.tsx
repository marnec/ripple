import { ProjectColorTag } from "@/components/ProjectColorTag";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { Id } from "@convex/_generated/dataModel";
import { PROJECT_TABS } from "../Project/project-tabs";

// The tabs worth a one-click jump. Overview is the card title itself; Settings
// is rare enough to reach from inside the project.
const SHORTCUT_TABS = PROJECT_TABS.filter((tab) =>
  ["tasks", "backlog", "cycles", "calendar"].includes(tab.to),
);

type FavoriteProject = {
  projectId: Id<"projects">;
  name: string;
  color: string;
};

/**
 * One card per favorited project: the name opens the project, the row below
 * jumps straight to its working tabs. This is how someone who runs projects
 * rather than works tasks in them (a PM) gets anything useful from the
 * dashboard.
 */
export function FavoriteProjects({
  workspaceId,
  projects,
}: {
  workspaceId: string;
  projects: FavoriteProject[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => {
        const base = `/workspaces/${workspaceId}/projects/${project.projectId}`;
        return (
          <div key={project.projectId} className="overflow-hidden rounded-lg border">
            <Link
              to={base}
              className="group flex items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/50"
            >
              <ProjectColorTag color={project.color} />
              <span className="flex-1 truncate text-sm font-medium">{project.name}</span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            </Link>
            <nav
              aria-label={`${project.name} sections`}
              className="grid grid-cols-4 divide-x border-t"
            >
              {SHORTCUT_TABS.map((tab) => (
                <Link
                  key={tab.to}
                  to={`${base}/${tab.to}`}
                  className="flex h-9 items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <tab.icon className="size-3.5 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </Link>
              ))}
            </nav>
          </div>
        );
      })}
    </div>
  );
}
