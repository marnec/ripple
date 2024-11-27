import { useParams } from "react-router-dom";
import { Id } from "../../../convex/_generated/dataModel";
import { Chat } from "./Chat";
import { ChatIntro } from "./ChatIntro";
import { api } from "../../../convex/_generated/api";
import { useQuery } from "convex/react";

export function ChatLayout() {
    const { workspaceId, channelId } = useParams();
    const user = useQuery(api.users.viewer);

    return (
        <div className="flex-1 flex flex-col">
            <ChatIntro workspaceId={workspaceId} channelId={channelId} />
            <Chat viewer={user?._id!} channelId={channelId as Id<"channels">} />
        </div>
    );
}