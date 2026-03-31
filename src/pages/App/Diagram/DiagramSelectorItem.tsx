import { FilePen, MoreHorizontal, Settings, StarOff } from "lucide-react";
import {
    SidebarMenuSubButton,
    SidebarMenuSubItem,
} from "../../../components/ui/sidebar";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuSeparator,
  ResponsiveDropdownMenuTrigger,
} from "../../../components/ui/responsive-dropdown-menu";

import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { SIDEBAR_ELEMENT_FADEIN_DELAY } from "../Resources/sidebar-constants";

export interface DiagramSelectorItemProps {
  idx: number;
  diagram: Pick<Doc<"diagrams">, "_id" | "name">;
  diagramId: Id<"diagrams"> | undefined;
  onDiagramSelect: (id: string) => void;
  onRenameDiagram: (id: Id<"diagrams">) => void;
  onManageDiagram: (id: Id<"diagrams">) => void;
  onUnstarDiagram: (id: Id<"diagrams">) => void;
}

export function DiagramSelectorItem({
  idx,
  diagram,
  diagramId,
  onDiagramSelect,
  onRenameDiagram,
  onManageDiagram,
  onUnstarDiagram
}: DiagramSelectorItemProps) {
  return (
    <SidebarMenuSubItem className="group/subitem relative animate-fade-in"
      style={{ animationDelay: `${idx * SIDEBAR_ELEMENT_FADEIN_DELAY}ms`, animationFillMode: "backwards" }}>
      <SidebarMenuSubButton
        render={<div
          onClick={() => onDiagramSelect(diagram._id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onDiagramSelect(diagram._id);
            }
          }}
          className="cursor-pointer pr-6"
        />}
        isActive={diagram._id === diagramId}
      >
          <span className="truncate">{diagram.name}</span>
      </SidebarMenuSubButton>
      <ResponsiveDropdownMenu>
        <ResponsiveDropdownMenuTrigger render={<button className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-sidebar-foreground/60 md:opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground md:group-hover/subitem:opacity-100 data-popup-open:opacity-100" />}>
            <MoreHorizontal className="size-3.5" />
        </ResponsiveDropdownMenuTrigger>
        <ResponsiveDropdownMenuContent className="w-48 rounded-lg">
          <ResponsiveDropdownMenuItem onSelect={() => onRenameDiagram(diagram._id)}>
            <FilePen className="text-muted-foreground" />
            <span>Rename</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuItem onSelect={() => onManageDiagram(diagram._id)}>
            <Settings className="text-muted-foreground" />
            <span>Settings</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuSeparator />
          <ResponsiveDropdownMenuItem onSelect={() => onUnstarDiagram(diagram._id)}>
            <StarOff className="text-muted-foreground" />
            <span>Unstar</span>
          </ResponsiveDropdownMenuItem>
        </ResponsiveDropdownMenuContent>
      </ResponsiveDropdownMenu>
    </SidebarMenuSubItem>
  );
}
