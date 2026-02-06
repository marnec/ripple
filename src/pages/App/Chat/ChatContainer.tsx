import { QueryParams } from "@shared/types/routes";
import { useParams } from "react-router-dom";
import { Chat } from "./Chat";

export function ChatContainer() {
  const { channelId } = useParams<QueryParams>();

  return (
    <div className="flex w-full flex-col justify-between">
      {channelId && (
        <>
          <Chat channelId={channelId} />
        </>
      )}
    </div>
  );
}
