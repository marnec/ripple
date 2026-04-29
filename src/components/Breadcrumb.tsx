import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "../../convex/_generated/api";
import React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWorkspaceSidebar } from "@/contexts/WorkspaceSidebarContext";
import { ProjectColorTag } from "./ProjectColorTag";

interface BreadcrumbItemData {
  href: string;
  label: string;
  resourceId?: string;
  category?: string;
}

const KNOWN_SUBPAGES = new Set(["settings", "import", "videocall", "tasks", "cycles", "my-tasks"]);

/** Category segment → which sidebar list contains that resource type. */
const SIDEBAR_CATEGORY: Record<string, "projects" | "documents" | "diagrams" | "spreadsheets" | "channels"> = {
  projects: "projects",
  documents: "documents",
  diagrams: "diagrams",
  spreadsheets: "spreadsheets",
  channels: "channels",
};

export function DynamicBreadcrumb() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const sidebarData = useWorkspaceSidebar();
  const workspaces = useQuery(api.workspaces.list);

  const items = (() => {
    const pathSegments = location.pathname.split("/").filter(Boolean);
    const built: BreadcrumbItemData[] = [];
    for (let i = 0; i < pathSegments.length; i++) {
      const segment = pathSegments[i];
      const href = `/${pathSegments.slice(0, i + 1).join("/")}`;
      const isResource = i % 2 !== 0 && !KNOWN_SUBPAGES.has(segment);

      if (isResource) {
        built.push({ href, label: segment, resourceId: segment, category: pathSegments[i - 1] });
      } else {
        built.push({
          href,
          label: segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " "),
          category: segment,
        });
      }
    }
    return built;
  })();

  // Resolve names client-side from sidebar data + workspace list when possible
  const localNames = (() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (!item.resourceId || !item.category) continue;
      if (item.category === "workspaces") {
        const ws = workspaces?.find((w) => w._id === item.resourceId);
        if (ws) map.set(item.resourceId, ws.name);
        continue;
      }
      if (!sidebarData) continue;
      const listKey = SIDEBAR_CATEGORY[item.category];
      if (!listKey) continue;
      const list = sidebarData[listKey] as { _id: string; name: string }[];
      const found = list?.find((r) => r._id === item.resourceId);
      if (found) map.set(item.resourceId, found.name);
    }
    return map;
  })();

  // Only fetch from server for IDs not resolved locally (tasks, cycles, workspaces)
  const unresolvedIds = items
    .filter((item) => item.resourceId && !localNames.has(item.resourceId))
    .map((item) => item.resourceId!);
  const serverNamesMap = useQuery(
    api.breadcrumb.getResourceNames,
    unresolvedIds.length > 0 ? { resourceIds: unresolvedIds as any } : "skip",
  );

  // Merge local + server names
  const namesMap = (() => {
    const merged: Record<string, string | null> = {};
    for (const [id, name] of localNames) merged[id] = name;
    if (serverNamesMap) Object.assign(merged, serverNamesMap);
    return merged;
  })();

  // Show "..." only for unresolved IDs that are still loading from the server
  const isLoading = unresolvedIds.length > 0 && !serverNamesMap;

  if (isMobile) {
    const lastItem = items.length > 0 ? items[items.length - 1] : null;
    if (!lastItem) return null;
    // For subpages of a resource (e.g. /projects/:id/tasks), surface the
    // parent resource as the title so projects feel uniform with other
    // resources whose URL ends in the resource ID.
    let titleItem = lastItem;
    if (!lastItem.resourceId && items.length >= 2) {
      const parent = items[items.length - 2];
      if (parent.resourceId && parent.category !== "workspaces") {
        titleItem = parent;
      }
    }
    const displayName = titleItem.resourceId
      ? (namesMap[titleItem.resourceId] ?? (isLoading ? "..." : titleItem.label))
      : titleItem.label;
    const projectColor =
      titleItem.category === "projects" && titleItem.resourceId && sidebarData
        ? sidebarData.projects.find((p) => p._id === titleItem.resourceId)?.color
        : undefined;
    return (
      <div className="flex items-center gap-2 min-w-0">
        {projectColor && <ProjectColorTag color={projectColor} />}
        <span className="text-base font-semibold truncate">{displayName}</span>
      </div>
    );
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => {
          const delay = `${index * 50}ms`;
          let displayName: string;
          if (item.resourceId) {
            displayName = namesMap[item.resourceId] ?? (isLoading ? "..." : item.label);
          } else {
            displayName = item.label;
          }

          return (
            <React.Fragment key={item.href}>
              {index > 0 && (
                <BreadcrumbSeparator
                  className="animate-in fade-in duration-200 fill-mode-both"
                  style={{ animationDelay: delay }}
                />
              )}
              <BreadcrumbItem
                className="animate-in fade-in duration-200 fill-mode-both"
                style={{ animationDelay: delay }}
              >
                <BreadcrumbLink
                  onClick={() => void navigate(item.href)}
                  className="cursor-pointer"
                >
                  {displayName}
                </BreadcrumbLink>
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
