import { ShareDialog } from "@/components/ShareDialog";
import { Button } from "@/components/ui/button";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex-helpers/react/cache";
import { Share2 } from "lucide-react";
import { useState } from "react";

interface ShareCallButtonProps {
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
}

/**
 * Admin-only icon button rendered inside the call's controls bar
 * alongside mute/camera/screen-share. Opens the ShareDialog prefilled
 * for the channel so admins can generate a guest-join link.
 */
export function ShareCallButton({ channelId, workspaceId }: ShareCallButtonProps) {
  const [open, setOpen] = useState(false);
  const myRole = useQuery(api.workspaceMembers.myRole, { workspaceId });
  const channel = useQuery(api.channels.get, { id: channelId });

  if (myRole !== "admin" || !channel) return null;

  return (
    <>
      <Button
        variant="secondary"
        size="icon"
        className="h-11 w-11 md:h-9 md:w-9"
        onClick={() => setOpen(true)}
        title="Share call link"
      >
        <Share2 className="h-5 w-5" />
      </Button>
      <ShareDialog
        open={open}
        onOpenChange={setOpen}
        resourceType="channel"
        resourceId={channelId}
        resourceName={channel.name}
      />
    </>
  );
}
