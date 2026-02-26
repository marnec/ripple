import { useIsMobile } from "@/hooks/use-mobile";
import { Cog, Folder, MoreHorizontal, Trash2 } from "lucide-react";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../../../components/ui/sidebar";

export interface ProjectSelectorItemProps {
  project: Doc<"projects">;
  projectId: Id<"projects"> | undefined;
  onProjectSelect: (id: string | null) => void;
  onManageProject: (id: Id<"projects">) => void;
  onDeleteProject: (id: Id<"projects">) => void;
}

export function ProjectSelectorItem({
  project,
  projectId,
  onProjectSelect,
  onManageProject,
  onDeleteProject,
}: ProjectSelectorItemProps) {
  const isMobile = useIsMobile();

  return (
    <SidebarMenuSubItem className="group/subitem relative">
      <SidebarMenuSubButton
        asChild
        isActive={project._id === projectId}
      >
        <div onClick={() => onProjectSelect(project._id)} className="cursor-pointer pr-6">
          <span className={`w-2 h-2 rounded-full shrink-0 ${project.color}`} />
          <span className="truncate">{project.name}</span>
        </div>
      </SidebarMenuSubButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-sidebar-foreground/60 opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover/subitem:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-48 rounded-lg"
          side={isMobile ? "bottom" : "right"}
          align={isMobile ? "end" : "start"}
        >
          <DropdownMenuItem onClick={() => onProjectSelect(project._id)}>
            <Folder className="text-muted-foreground" />
            <span>View project</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onManageProject(project._id)}>
            <Cog className="text-muted-foreground" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onDeleteProject(project._id)}>
            <Trash2 className="text-muted-foreground" />
            <span>Delete project</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuSubItem>
  );
}
