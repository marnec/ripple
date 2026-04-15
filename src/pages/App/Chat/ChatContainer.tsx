import { ResourceDeleted } from "@/pages/ResourceDeleted";
import type { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex-helpers/react/cache";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Chat } from "./Chat";
import { ClosedChannelGate } from "../Channel/ClosedChannelGate";
import { DmGate } from "../Channel/DmGate";

export function ChatContainer() {
  const { channelId } = useParams<QueryParams>();
  const channel = useQuery(api.channels.get, channelId ? { id: channelId } : "skip");
  const accessInfo = useQuery(
    api.channels.getAccessInfo,
    channelId ? { channelId } : "skip",
  );

  // null means deleted or not-found. undefined means still loading.
  if (channel === null || accessInfo === null) {
    return <ResourceDeleted resourceType="channel" />;
  }

  if (accessInfo && !accessInfo.isMember) {
    if (accessInfo.type === "dm") {
      return <DmGate participants={accessInfo.participants} />;
    }
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
