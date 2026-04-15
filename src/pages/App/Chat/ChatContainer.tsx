import { ResourceDeleted } from "@/pages/ResourceDeleted";
import type { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex-helpers/react/cache";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Chat } from "./Chat";
import { ClosedChannelGate } from "../Channel/ClosedChannelGate";

export function ChatContainer() {
  const { channelId } = useParams<QueryParams>();
  const channel = useQuery(api.channels.get, channelId ? { id: channelId } : "skip");
  const accessInfo = useQuery(
    api.channels.getAccessInfo,
    channelId ? { channelId } : "skip",
  );

  // channel === undefined means still loading, null means deleted/no access
  if (channel === null) {
    return <ResourceDeleted resourceType="channel" />;
  }

  // Non-member of a closed channel
  if (accessInfo && !accessInfo.isMember) {
    return (
      <ClosedChannelGate
        channelId={channelId!}
        name={accessInfo.name}
        memberCount={accessInfo.memberCount}
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      {channelId && (
        <>
          <Chat channelId={channelId} />
        </>
      )}
    </div>
  );
}
