import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { Globe, Lock } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ChannelType } from "@ripple/shared/enums";
import type { Values } from "@ripple/shared/types/object";

interface ChannelDetailsSectionProps {
  channelId: Id<"channels">;
  channelName: string;
  channelType: Values<typeof ChannelType>;
  isAdmin: boolean;
}

export function ChannelDetailsSection({
  channelId,
  channelName: serverName,
  channelType,
  isAdmin,
}: ChannelDetailsSectionProps) {
  const updateChannel = useMutation(api.channels.update);
  const [localName, setLocalName] = useState<string | null>(null);

  const displayName = localName ?? serverName;
  const hasChanges = localName !== null;

  const handleSave = async () => {
    try {
      await updateChannel({
        id: channelId,
        ...(localName !== null && { name: localName }),
      });
      toast.success("Channel updated");
      setLocalName(null);
    } catch (error) {
      toast.error("Error updating channel", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-4">Details</h2>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="channel-name">Channel Name</Label>
          <Input
            id="channel-name"
            value={displayName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder="Enter channel name"
            disabled={!isAdmin}
          />
        </div>

        <div className="space-y-2">
          <Label>Type</Label>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {channelType === "open" ? (
              <>
                <Globe className="w-4 h-4" />
                <span>Open — any workspace member can join</span>
              </>
            ) : channelType === "dm" ? (
              <>
                <Lock className="w-4 h-4" />
                <span>Direct message</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                <span>Closed — only invited members can participate</span>
              </>
            )}
          </div>
        </div>

        {hasChanges && isAdmin && (
          <Button onClick={() => void handleSave()}>Save Changes</Button>
        )}
      </div>
    </section>
  );
}
