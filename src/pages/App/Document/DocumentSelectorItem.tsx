import { FilePen, MoreHorizontal, Settings, StarOff } from "lucide-react";
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

export interface DocumentSelectorItemProps {
  document: Doc<"documents">;
  documentId: Id<"documents"> | undefined;
  onDocumentSelect: (id: string | null) => void;
  onRenameDocument: (id: Id<"documents">) => void;
  onManageDocument: (id: Id<"documents">) => void;
  onUnstarDocument: (id: Id<"documents">) => void;
}

export function DocumentSelectorItem({
  document,
  documentId,
  onDocumentSelect,
  onRenameDocument,
  onManageDocument,
  onUnstarDocument,
}: DocumentSelectorItemProps) {
  return (
    <SidebarMenuSubItem className="group/subitem relative">
      <SidebarMenuSubButton
        render={<div onClick={() => onDocumentSelect(document._id)} className="cursor-pointer pr-6" />}
        isActive={document._id === documentId}
      >
          <span className="truncate">{document.name}</span>
      </SidebarMenuSubButton>
      <ResponsiveDropdownMenu>
        <ResponsiveDropdownMenuTrigger render={<button className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-sidebar-foreground/60 md:opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground md:group-hover/subitem:opacity-100 data-popup-open:opacity-100" />}>
            <MoreHorizontal className="size-3.5" />
        </ResponsiveDropdownMenuTrigger>
        <ResponsiveDropdownMenuContent className="w-48 rounded-lg">
          <ResponsiveDropdownMenuItem onClick={() => onRenameDocument(document._id)}>
            <FilePen className="text-muted-foreground" />
            <span>Rename</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuItem onClick={() => onManageDocument(document._id)}>
            <Settings className="text-muted-foreground" />
            <span>Settings</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuSeparator />
          <ResponsiveDropdownMenuItem onClick={() => onUnstarDocument(document._id)}>
            <StarOff className="text-muted-foreground" />
            <span>Unstar</span>
          </ResponsiveDropdownMenuItem>
        </ResponsiveDropdownMenuContent>
      </ResponsiveDropdownMenu>
    </SidebarMenuSubItem>
  );
}
