import { Cog, Folder, MoreHorizontal, StarOff } from "lucide-react";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuSeparator,
  ResponsiveDropdownMenuTrigger,
} from "../../../components/ui/responsive-dropdown-menu";
import { SidebarMenuSubButton, SidebarMenuSubItem } from "../../../components/ui/sidebar";
import { cn } from "@/lib/utils";
import { ProjectColorTag } from "@/components/ProjectColorTag";
import { SIDEBAR_ELEMENT_FADEIN_DELAY } from "../Resources/sidebar-constants";

export interface ProjectSelectorItemProps {
  idx: number;
  project: Pick<Doc<"projects">, "_id" | "name" | "color">;
  projectId: Id<"projects"> | undefined;
  onProjectSelect: (id: string | null) => void;
  onManageProject: (id: Id<"projects">) => void;
  onUnstarProject: (id: Id<"projects">) => void;
}

export function ProjectSelectorItem({
  idx,
  project,
  projectId,
  onProjectSelect,
  onManageProject,
  onUnstarProject,
}: ProjectSelectorItemProps) {
  return (
    <SidebarMenuSubItem
      className={cn("group/subitem relative animate-fade-in")}
      style={{
        animationDelay: `${idx * SIDEBAR_ELEMENT_FADEIN_DELAY}ms`,
        animationFillMode: "backwards",
      }}
    >
      <SidebarMenuSubButton
        render={
          <div
            onClick={() => onProjectSelect(project._id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onProjectSelect(project._id);
              }
            }}
            className="cursor-pointer pr-6"
          />
        }
        isActive={project._id === projectId}
      >
        <ProjectColorTag color={project.color} />
        <span className="truncate">{project.name}</span>
      </SidebarMenuSubButton>
      <ResponsiveDropdownMenu>
        <ResponsiveDropdownMenuTrigger
          render={
            <button className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-sidebar-foreground/60 md:opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground md:group-hover/subitem:opacity-100 data-popup-open:opacity-100" />
          }
        >
          <MoreHorizontal className="size-3.5" />
        </ResponsiveDropdownMenuTrigger>
        <ResponsiveDropdownMenuContent className="w-48 rounded-lg">
          <ResponsiveDropdownMenuItem onSelect={() => onProjectSelect(project._id)}>
            <Folder className="text-muted-foreground" />
            <span>View project</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuItem onSelect={() => onManageProject(project._id)}>
            <Cog className="text-muted-foreground" />
            <span>Settings</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuSeparator />
          <ResponsiveDropdownMenuItem onSelect={() => onUnstarProject(project._id)}>
            <StarOff className="text-muted-foreground" />
            <span>Unstar</span>
          </ResponsiveDropdownMenuItem>
        </ResponsiveDropdownMenuContent>
      </ResponsiveDropdownMenu>
    </SidebarMenuSubItem>
  );
}
