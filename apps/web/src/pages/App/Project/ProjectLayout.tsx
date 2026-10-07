import { FavoriteButton } from "@/components/FavoriteButton";
import { ProjectColorTag } from "@/components/ProjectColorTag";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@convex/types/routes";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useQuery } from "convex-helpers/react/cache";
import { useParams, NavLink, Navigate, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useRecordVisit } from "@/hooks/use-record-visit";
import { useShortcut } from "@/contexts/ShortcutsContext";
import { ImportActiveBanner } from "./ImportActiveBanner";
import { PROJECT_TABS as tabs } from "./project-tabs";
import { TASK_SHEET_PARAM } from "./taskSheetParam";

export function ProjectLayout() {
  const { workspaceId, projectId } = useParams<QueryParams>();
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const sheetTaskId = searchParams.get(TASK_SHEET_PARAM);

  if (!workspaceId || !projectId) {
    return <SomethingWentWrong />;
  }

  // Mobile has no task sheet — every surface navigates to the task page
  // instead — so a `?task=` link (shared, or copied on desktop) opens the
  // page in place of the surface it was pointing at.
  if (isMobile && sheetTaskId) {
    return <Navigate replace to={`/workspaces/${workspaceId}/projects/${projectId}/tasks/${sheetTaskId}`} />;
  }

  return (
    <ProjectLayoutContent
      workspaceId={workspaceId}
      projectId={projectId}
    />
  );
}

function ProjectLayoutContent({
  workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const project = useQuery(api.projects.get, { id: projectId });
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Mod+⇧←/→ step through the tabs, wrapping at the ends. Each chord's hint
  // sits on the tab it would land on.
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\/|\/$/g, "") : null;
  const activeIndex =
    rest === null
      ? -1
      : tabs.findIndex((tab) => (tab.end ? rest === "" : rest === tab.to || rest.startsWith(`${tab.to}/`)));
  const prevIndex = (activeIndex - 1 + tabs.length) % tabs.length;
  const nextIndex = (activeIndex + 1) % tabs.length;
  const goToTab = (index: number) => void navigate(tabs[index].end ? base : `${base}/${tabs[index].to}`);
  const prevTabRef = useShortcut("prevTab", () => goToTab(prevIndex), { enabled: activeIndex >= 0 });
  const nextTabRef = useShortcut("nextTab", () => goToTab(nextIndex), { enabled: activeIndex >= 0 });

  useRecordVisit(workspaceId, "project", projectId, project?.name);

  if (project === null) {
    return <ResourceDeleted resourceType="project" />;
  }

  const isLoading = project === undefined;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Project header with inline tabs */}
      <div className="flex items-center justify-between gap-4 px-4 border-b min-h-11">
        <div className="flex items-center gap-2 min-w-0">
          <FavoriteButton
            shortcut
            resourceType="project"
            resourceId={projectId}
            workspaceId={workspaceId}
          />
          {!isMobile && !isLoading && (
            <div className="flex items-center gap-2 min-w-0 animate-fade-in">
              <ProjectColorTag color={project.color} />
              <h1 className="text-lg font-semibold truncate">{project.name}</h1>
            </div>
          )}
        </div>

        <div className="inline-flex h-8 items-center justify-center rounded-lg bg-muted p-1 shrink-0">
          {tabs.map((tab, index) => (
            <NavLink
              key={tab.to}
              ref={index === prevIndex ? prevTabRef : index === nextIndex ? nextTabRef : undefined}
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
              <tab.icon className="size-4 sm:hidden" />
              <span className="hidden sm:inline">{tab.label}</span>
            </NavLink>
          ))}
        </div>
      </div>

      <MobileHeaderTitle
        name={project?.name}
        accent={project ? <ProjectColorTag color={project.color} /> : undefined}
      />


      {/* Active CSV-import notice. Renders nothing when no import is running. */}
      <ImportActiveBanner workspaceId={workspaceId} projectId={projectId} />

      {/* Page content */}
      <div className="flex-1 flex flex-col min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
