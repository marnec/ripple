import { ResourceDeleted } from "@/pages/ResourceDeleted";
import type { QueryParams } from "@convex/types/routes";
import { useQuery } from "convex-helpers/react/cache";
import { useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
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
          {/* Keyed by channel: switching channels changes a route param, not the
              route, so without this React keeps the same Chat instance and its
              per-channel state — the pending reply target above all. A reply
              carried into another channel used to post there silently; the
              server now refuses a cross-channel parent, so a stale target would
              surface as "Could not send message". Remounting is the React-native
              way to reset identity-scoped state (also clears the pending edit,
              context view and search box, all equally channel-scoped). */}
          <Chat key={channelId} channelId={channelId} />
        </>
      )}
    </div>
  );
}
