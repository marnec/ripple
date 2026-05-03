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
 * Admin-only pill rendered on the channel call page. Opens the ShareDialog
 * prefilled for the channel so admins can generate a guest-join link.
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
        size="sm"
        className="gap-2"
        onClick={() => setOpen(true)}
      >
        <Share2 className="h-4 w-4" />
        Share call link
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
