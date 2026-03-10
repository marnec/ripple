import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { Globe, Lock } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

interface ChannelDetailsSectionProps {
  channelId: Id<"channels">;
  channelName: string;
  isPublic: boolean;
  isAdmin: boolean;
}

export function ChannelDetailsSection({
  channelId,
  channelName: serverName,
  isPublic,
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
        <div>
          <Label htmlFor="channel-name">Channel Name</Label>
          <Input
            id="channel-name"
            value={displayName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder="Enter channel name"
            disabled={!isAdmin}
          />
        </div>

        <div>
          <Label>Visibility</Label>
          <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
            {isPublic ? (
              <>
                <Globe className="w-4 h-4" />
                <span>Public — visible to all workspace members</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                <span>Private — only visible to channel members</span>
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
