import { useIsMobile } from "@/hooks/use-mobile";
import { FilePen, MoreHorizontal, Settings, Trash2 } from "lucide-react";
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

import { Doc, Id } from "../../../../convex/_generated/dataModel";

export interface DiagramSelectorItemProps {
  diagram: Doc<"diagrams">;
  diagramId: Id<"diagrams"> | undefined;
  onDiagramSelect: (id: string) => void;
  onRenameDiagram: (id: Id<"diagrams">) => void;
  onManageDiagram: (id: Id<"diagrams">) => void;
  onDeleteDiagram: (id: Id<"diagrams">) => void;
}

export function DiagramSelectorItem({
  diagram,
  diagramId,
  onDiagramSelect,
  onRenameDiagram,
  onManageDiagram,
  onDeleteDiagram
}: DiagramSelectorItemProps) {
  const isMobile = useIsMobile();

  return (
    <SidebarMenuSubItem className="group/subitem relative">
      <SidebarMenuSubButton
        asChild
        isActive={diagram._id === diagramId}
      >
        <div onClick={() => onDiagramSelect(diagram._id)} className="cursor-pointer pr-6">
          <span className="truncate">{diagram.name}</span>
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
          <DropdownMenuItem onClick={() => onRenameDiagram(diagram._id)}>
            <FilePen className="text-muted-foreground" />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onManageDiagram(diagram._id)}>
            <Settings className="text-muted-foreground" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onDeleteDiagram(diagram._id)}>
            <Trash2 className="text-muted-foreground" />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuSubItem>
  );
}
