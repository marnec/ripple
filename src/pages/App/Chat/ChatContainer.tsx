import { QueryParams } from "@shared/types/routes";
import { useParams } from "react-router-dom";
import { Chat } from "./Chat";

export function ChatContainer() {
  const { channelId } = useParams<QueryParams>();

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
