import { Button } from "@ripple/ui/components/button";
import { removeFromKnownChannels } from "@/hooks/use-acknowledged-channels";
import type { Id } from "@convex/_generated/dataModel";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LeaveChannelDialog } from "./LeaveChannelDialog";

interface ChannelLeaveSectionProps {
  channelId: Id<"channels">;
  channelName: string;
  workspaceId: Id<"workspaces">;
}

/**
 * The settings-page twin of the sidebar's "Leave channel" item, and the
 * private-channel counterpart to `ChannelDismissSection`: a private channel is
 * left, not dismissed, because membership is what grants access to it.
 *
 * The last-admin case (promote someone before leaving) lives in
 * `LeaveChannelDialog`, shared with the sidebar.
 */
export function ChannelLeaveSection({
  channelId,
  channelName,
  workspaceId,
}: ChannelLeaveSectionProps) {
  const navigate = useNavigate();
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        You'll lose access to this channel and its messages, and you'll need to
        be re-invited to rejoin. Nothing is deleted, and the channel keeps
        running for everyone else.
      </p>
      <Button variant="destructive" onClick={() => setShowLeaveDialog(true)}>
        <LogOut className="w-4 h-4 mr-2" />
        Leave Channel
      </Button>
      <LeaveChannelDialog
        open={showLeaveDialog}
        onOpenChange={setShowLeaveDialog}
        channelId={channelId}
        channelName={channelName}
        onLeft={() => {
          removeFromKnownChannels(workspaceId, channelId);
          // The settings page of a channel you can no longer read is a dead
          // end — every query on it is about to come back empty.
          void navigate(`/workspaces/${workspaceId}/channels`);
        }}
      />
    </div>
  );
}
