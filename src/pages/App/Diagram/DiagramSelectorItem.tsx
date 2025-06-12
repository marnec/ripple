import { useIsMobile } from "@/hooks/use-mobile";
import { PenTool, FilePen, MoreHorizontal, Trash2 } from "lucide-react";
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
    SidebarMenuItem
} from "../../../components/ui/sidebar";

import { Doc, Id } from "../../../../convex/_generated/dataModel";

export interface DiagramSelectorItemProps {
  diagram: Doc<"diagrams">;
  diagramId: Id<"diagrams"> | undefined;
  onDiagramSelect: (id: string) => void;
  onRenameDiagram: (id: Id<"diagrams">) => void;
  onDeleteDiagram: (id: Id<"diagrams">) => void;
}

export function DiagramSelectorItem({
  diagram,
  diagramId,
  onDiagramSelect,
  onRenameDiagram,
  onDeleteDiagram
}: DiagramSelectorItemProps) {
  const isMobile = useIsMobile();
  
  return (
    <SidebarMenuItem key={diagram._id}>
      <SidebarMenuButton
        asChild
        variant={diagram._id === diagramId ? "outline" : "default"}
        onClick={() => onDiagramSelect(diagram._id)}
      >
        <div>
          <PenTool /> {diagram.name}
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
          <DropdownMenuItem onClick={() => onRenameDiagram(diagram._id)}>
            <FilePen className="text-muted-foreground" />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onDeleteDiagram(diagram._id)}>
            <Trash2 className="text-muted-foreground" />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
} 