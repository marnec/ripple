import { useIsMobile } from "@/hooks/use-mobile";
import { File, FilePen, MoreHorizontal, Trash2 } from "lucide-react";
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
    SidebarMenuItem
} from "../../../components/ui/sidebar";
export interface DocumentSelectorItemProps {
  document: Doc<"documents">;
  documentId: Id<"documents"> | undefined;
  onDocumentSelect: (id: string) => void;
  onRenameDocument: (id: Id<"documents">) => void;
  onDeleteDocument: (id: Id<"documents">) => void
}

export function DocumentSelectorItem({
  document,
  documentId,
  onDocumentSelect,
  onRenameDocument,
  onDeleteDocument
}: DocumentSelectorItemProps) {
  const isMobile = useIsMobile();
  
  return (
    <SidebarMenuItem key={document._id}>
      <SidebarMenuButton
        asChild
        variant={document._id === documentId ? "outline" : "default"}
        onClick={() => onDocumentSelect(document._id)}
      >
        <div>
          <File /> {document.name}
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
          <DropdownMenuItem onClick={() => onRenameDocument(document._id)}>
            <FilePen className="text-muted-foreground" />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onDeleteDocument(document._id)}>
            <Trash2 className="text-muted-foreground" />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
