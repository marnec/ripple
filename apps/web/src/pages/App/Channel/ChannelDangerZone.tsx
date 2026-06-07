import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { removeFromKnownChannels } from "@/hooks/use-acknowledged-channels";

interface ChannelDangerZoneProps {
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
}

export function ChannelDangerZone({ channelId, workspaceId }: ChannelDangerZoneProps) {
  const navigate = useNavigate();
  const deleteChannel = useMutation(api.channels.remove);

  const handleDelete = async () => {
    if (
      !confirm(
        "Are you sure you want to delete this channel? All messages will be permanently lost.",
      )
    ) {
      return;
    }
    try {
      await deleteChannel({ id: channelId });
      removeFromKnownChannels(workspaceId, channelId);
      toast.success("Channel deleted");
      void navigate(`/workspaces/${workspaceId}`);
    } catch (error) {
      toast.error("Error deleting channel", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        This will permanently delete the channel and all its messages. This
        cannot be undone.
      </p>
      <Button variant="destructive" onClick={() => void handleDelete()}>
        <Trash2 className="w-4 h-4 mr-2" />
        Delete Channel
      </Button>
    </div>
  );
}
