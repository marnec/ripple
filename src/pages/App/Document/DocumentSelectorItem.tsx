import { useIsMobile } from "@/hooks/use-mobile";
import { FilePen, MoreHorizontal, Settings, Trash2 } from "lucide-react";
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

export interface DocumentSelectorItemProps {
  document: Doc<"documents">;
  documentId: Id<"documents"> | undefined;
  onDocumentSelect: (id: string | null) => void;
  onRenameDocument: (id: Id<"documents">) => void;
  onManageDocument: (id: Id<"documents">) => void;
  onDeleteDocument: (id: Id<"documents">) => void;
}

export function DocumentSelectorItem({
  document,
  documentId,
  onDocumentSelect,
  onRenameDocument,
  onManageDocument,
  onDeleteDocument,
}: DocumentSelectorItemProps) {
  const isMobile = useIsMobile();

  return (
    <SidebarMenuSubItem className="group/subitem relative">
      <SidebarMenuSubButton
        asChild
        isActive={document._id === documentId}
      >
        <div onClick={() => onDocumentSelect(document._id)} className="cursor-pointer pr-6">
          <span className="truncate">{document.name}</span>
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
          <DropdownMenuItem onClick={() => onRenameDocument(document._id)}>
            <FilePen className="text-muted-foreground" />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onManageDocument(document._id)}>
            <Settings className="text-muted-foreground" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onDeleteDocument(document._id)}>
            <Trash2 className="text-muted-foreground" />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuSubItem>
  );
}
