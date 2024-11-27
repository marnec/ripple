import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "../ui/button";
import {
  PlusIcon,
  PersonIcon,
  GearIcon,
  CaretDownIcon,
} from "@radix-ui/react-icons";
import { useState } from "react";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { InviteUserDialog } from "../InviteUserDialog";
import { Id } from "../../../convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useNavigate, useParams } from "react-router-dom";

export function WorkspaceSelector({
  onWorkspaceSelect,
}: {
  onWorkspaceSelect: (id: string) => void;
}) {
  const workspaces = useQuery(api.workspaces.list);
  const { workspaceId } = useParams();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [selectedWorkspaceForInvite, setSelectedWorkspaceForInvite] = useState<string | null>(null);
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between mb-2 ">
        <h2 className="font-semibold">Workspaces</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowCreateDialog(true)}
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        {workspaces?.map((workspace) =>
          workspace && (
            <div key={workspace._id} className="flex items-center gap-2">
              <Button
                variant={workspace._id === workspaceId ? "secondary" : "ghost"}
                className="flex-1 justify-start"
                onClick={() => onWorkspaceSelect(workspace._id)}
              >
                {workspace.name}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <CaretDownIcon className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => {
                      setSelectedWorkspaceForInvite(workspace._id);
                      setShowInviteDialog(true);
                    }}
                  >
                    <PersonIcon className="h-4 w-4 mr-2" />
                    Invite User
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      navigate(`/workspaces/${workspace._id}/settings`);
                    }}
                  >
                    <GearIcon className="h-4 w-4 mr-2" />
                    Settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        )}
      </div>

      <CreateWorkspaceDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />

      <InviteUserDialog
        workspaceId={selectedWorkspaceForInvite as Id<"workspaces">}
        open={showInviteDialog}
        onOpenChange={setShowInviteDialog}
      />
    </div>
  );
}
