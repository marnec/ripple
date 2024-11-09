import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/button";
import { PlusIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";


export function WorkspaceSelector({ 
  currentWorkspace,
  onWorkspaceSelect 
}: { 
  currentWorkspace?: string,
  onWorkspaceSelect: (id: string) => void 
}) {
  const workspaces = useQuery(api.workspaces.list);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

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
          <Button
            key={workspace._id}
            variant={workspace._id === currentWorkspace ? "secondary" : "ghost"}
            className="justify-start"
            onClick={() => onWorkspaceSelect(workspace._id)}
          >
            {workspace.name}
          </Button>
        ))}
      </div>

      <CreateWorkspaceDialog 
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
    </div>
  );
}