import { ResourceDeleted } from "@/pages/ResourceDeleted";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Chat } from "./Chat";

export function ChatContainer() {
  const { channelId } = useParams<QueryParams>();
  const channel = useQuery(api.channels.get, channelId ? { id: channelId } : "skip");

  // channel === undefined means still loading, null means deleted/no access
  if (channel === null) {
    return <ResourceDeleted resourceType="channel" />;
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
