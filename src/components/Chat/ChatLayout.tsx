import { useQuery } from "convex/react";
import { useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Chat } from "./Chat";

export function ChatLayout() {
    const { channelId } = useParams();
    const user = useQuery(api.users.viewer);

    return (
        <div className="flex w-full flex-col justify-between">
            <Chat viewer={user?._id!} channelId={channelId as Id<"channels">} />
        </div>
    );
}