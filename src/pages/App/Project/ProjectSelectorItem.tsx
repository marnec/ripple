import { Cog, Folder, MoreHorizontal, StarOff } from "lucide-react";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuSeparator,
  ResponsiveDropdownMenuTrigger,
} from "../../../components/ui/responsive-dropdown-menu";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../../../components/ui/sidebar";

export interface ProjectSelectorItemProps {
  project: Doc<"projects">;
  projectId: Id<"projects"> | undefined;
  onProjectSelect: (id: string | null) => void;
  onManageProject: (id: Id<"projects">) => void;
  onUnstarProject: (id: Id<"projects">) => void;
}

export function ProjectSelectorItem({
  project,
  projectId,
  onProjectSelect,
  onManageProject,
  onUnstarProject,
}: ProjectSelectorItemProps) {
  return (
    <SidebarMenuSubItem className="group/subitem relative">
      <SidebarMenuSubButton
        render={<div onClick={() => onProjectSelect(project._id)} className="cursor-pointer pr-6" />}
        isActive={project._id === projectId}
      >
          <span className={`w-2 h-2 rounded-full shrink-0 ${project.color}`} />
          <span className="truncate">{project.name}</span>
      </SidebarMenuSubButton>
      <ResponsiveDropdownMenu>
        <ResponsiveDropdownMenuTrigger render={<button className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-sidebar-foreground/60 md:opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground md:group-hover/subitem:opacity-100 data-popup-open:opacity-100" />}>
            <MoreHorizontal className="size-3.5" />
        </ResponsiveDropdownMenuTrigger>
        <ResponsiveDropdownMenuContent className="w-48 rounded-lg">
          <ResponsiveDropdownMenuItem onClick={() => onProjectSelect(project._id)}>
            <Folder className="text-muted-foreground" />
            <span>View project</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuItem onClick={() => onManageProject(project._id)}>
            <Cog className="text-muted-foreground" />
            <span>Settings</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuSeparator />
          <ResponsiveDropdownMenuItem onClick={() => onUnstarProject(project._id)}>
            <StarOff className="text-muted-foreground" />
            <span>Unstar</span>
          </ResponsiveDropdownMenuItem>
        </ResponsiveDropdownMenuContent>
      </ResponsiveDropdownMenu>
    </SidebarMenuSubItem>
  );
}
