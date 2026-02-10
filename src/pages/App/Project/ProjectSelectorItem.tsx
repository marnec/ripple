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
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
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
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        variant={project._id === projectId ? "outline" : "default"}
        onClick={() => onProjectSelect(project._id)}
      >
        <div className="flex flex-row items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${project.color}`} />
          <Folder size={16} />
          <span>{project.name}</span>
        </div>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover>
            <MoreHorizontal />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
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
    </SidebarMenuItem>
  );
}
