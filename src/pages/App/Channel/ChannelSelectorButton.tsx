import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Hash, Lock } from "lucide-react";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type ChannelSelectorButtonProps = {
    channelId: Id<"channels"> | undefined
    channel: Doc<"channels">
    onClick: (channelId: Id<"channels">) => void
}

export function ChannelSelectorButton({channelId, channel, onClick}: ChannelSelectorButtonProps) {

    return <SidebarMenuButton
    asChild
    variant={channel._id === channelId ? "outline" : "default"}
    onClick={() => onClick(channel._id)}
  >
    <div className="flex flex-row items-center">
      <div className="flex flex-row items-end ">
        <Hash size={18} />

        <Lock className={cn("size-3", "-ml-1", channel.isPublic ? 'invisible' : '')} />
      </div>

      <div>
        {channel.name}
      </div>
    </div>
  </SidebarMenuButton>
    
}