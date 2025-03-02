import { useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useQueryWithStatus } from "../AppSidebar";
import { Chat } from "./Chat";
import { QueryParams } from "@shared/types/routes";
import { Input } from "../ui/input";

export function ChatContainer() {
  const { channelId } = useParams<QueryParams>();
  const { data: user, isSuccess, isError } = useQueryWithStatus(api.users.viewer);

  return (
    <div className="flex w-full flex-col justify-between">
      {isSuccess && user && channelId && (
        <>
          <div className="p-2" >
            <Input placeholder="Search..."/>
          </div>
          <Chat viewer={user._id} channelId={channelId as Id<"channels">} />
        </>
      )}
      {isError && <p>Something went wrong while loading this chat</p>}
    </div>
  );
}
