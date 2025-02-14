import { useIsMobile } from "@/hooks/use-mobile";
import { useMutation, useQuery } from "convex/react";
import { File, FilePen, FilePlus, MoreHorizontal, Trash2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { RenameDocumentDialog } from "./RenameDocumentDialog";
import { useState } from "react";

export type DocumentSelectorProps = {
  workspaceId: Id<"workspaces">;
  documentId: Id<"documents"> | undefined;
  onDocumentSelect: (id: string) => void;
};

export function DocumentSelector({
  workspaceId,
  documentId,
  onDocumentSelect,
}: DocumentSelectorProps) {
  const isMobile = useIsMobile();

  const documents = useQuery(api.documents.list, { workspaceId });

  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);

  const createNewDocument = useMutation(api.documents.create);
  const deleteDocument = useMutation(api.documents.remove);

  const handleDocumentCreate = async () => {
    if (!workspaceId) return;

    const id = await createNewDocument({ workspaceId });

    onDocumentSelect(id);
  };

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Documents</SidebarGroupLabel>
      <SidebarGroupAction onClick={handleDocumentCreate} title="Create document">
        <FilePlus />
        <span className="sr-only">Create channel</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {documents?.map((document) => (
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
                <DropdownMenuItem onClick={() => setIsRenameDialogOpen(true)}>
                  <FilePen className="text-muted-foreground" />
                  <span>Rename</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => deleteDocument({ id: document._id })}>
                  <Trash2 className="text-muted-foreground" />
                  <span>Delete</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
      {documentId && (
        <RenameDocumentDialog
          documentId={documentId}
          open={isRenameDialogOpen}
          onOpenChange={setIsRenameDialogOpen}
        />
      )}
    </SidebarGroup>
  );
}
