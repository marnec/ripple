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

  // channel === undefined means still loading, null means deleted.
  // accessInfo === null means either not found or a DM the user isn't part of
  // (DMs are fully private — no gate, just treat as not found).
  if (channel === null || accessInfo === null) {
    return <ResourceDeleted resourceType="channel" />;
  }

  // Non-member of a closed channel — show the ask-to-join gate
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
