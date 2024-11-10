import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/button";
import { PlusIcon, PersonIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { InviteUserDialog } from "./InviteUserDialog";
import { Id } from "../../convex/_generated/dataModel";

export function WorkspaceSelector({
  currentWorkspace,
  onWorkspaceSelect,
}: {
  currentWorkspace?: string;
  onWorkspaceSelect: (id: string) => void;
}) {
  const workspaces = useQuery(api.workspaces.list);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [selectedWorkspaceForInvite, setSelectedWorkspaceForInvite] = useState<
    string | null
  >(null);

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
        {workspaces?.map((workspace) => (
          <div key={workspace._id} className="flex items-center gap-2">
            <Button
              variant={
                workspace._id === currentWorkspace ? "secondary" : "ghost"
              }
              className="flex-1 justify-start"
              onClick={() => onWorkspaceSelect(workspace._id)}
            >
              {workspace.name}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSelectedWorkspaceForInvite(workspace._id);
                setShowInviteDialog(true);
              }}
            >
              <PersonIcon className="h-4 w-4" />
            </Button>
          </div>
        ))}
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
