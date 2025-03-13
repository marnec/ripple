import { QueryParams } from "@shared/types/routes";
import { useParams } from "react-router-dom";
import { Input } from "../../../components/ui/input";
import { Chat } from "./Chat";

export function ChatContainer() {
  const { channelId } = useParams<QueryParams>();

  return (
    <div className="flex w-full flex-col justify-between">
      {channelId && (
        <>
          <div className="p-2">
            <Input placeholder="Search..." />
          </div>
          <Chat channelId={channelId} />
        </>
      )}
    </div>
  );
}
