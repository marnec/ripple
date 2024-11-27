import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/button";
import { PlusIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { Id } from "../../convex/_generated/dataModel";
import { CreateChannelDialog } from "./CreateChannelDialog";
import { useParams } from "react-router-dom";

export function ChannelSelector({ 
  workspaceId,
  onChannelSelect 
}: { 
  workspaceId: Id<"workspaces">,
  onChannelSelect: (id: string) => void 
}) {
  const {channelId} = useParams();
  const channels = useQuery(api.channels.list, { workspaceId });
  const [showCreateDialog, setShowCreateDialog] = useState(false);


  return (
    <div className="flex flex-col gap-2 p-4 border-t">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Channels</h2>
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => setShowCreateDialog(true)}
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
      </div>
      
      <div className="flex flex-col gap-1">
        {channels?.map((channel) => (
          <Button
            key={channel._id}
            variant={channel._id ===  channelId ? "secondary" : "ghost"}
            className="justify-start"
            onClick={() => onChannelSelect(channel._id)}
          >
            # {channel.name}
          </Button>
        ))}
      </div>

      <CreateChannelDialog
        workspaceId={workspaceId}
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
    </div>
  );
} 