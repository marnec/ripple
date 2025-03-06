import { UserContext } from "@/App";
import { useSanitize } from "@/hooks/use-sanitize";
import { cn } from "@/lib/utils";
import { MessageWithAuthor } from "@shared/types/channel";
import { useMutation } from "convex/react";
import { useCallback, useContext } from "react";
import { api } from "../../../convex/_generated/api";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../ui/context-menu";
import { useChatContext } from "./Chat";

type MessageProps = {
  message: MessageWithAuthor;
};

export function Message({ message }: MessageProps) {
  const { author, body, userId, _creationTime } = message;
  const user = useContext(UserContext);
  const sanitize = useSanitize();
  
  const userIsAuthor = userId === user?._id;

  const { setEditingMessage } = useChatContext()
  const deleteMessage = useMutation(api.messages.remove)

  const handleEdit = useCallback(() => setEditingMessage({ id: message._id, body: message.body }), [message])
  const handleDelete = useCallback(() => deleteMessage({ id: message._id }), [message])

  return (
    <ContextMenu>
      <li
        className={cn(
          "flex flex-col text-sm",
          userIsAuthor ? "items-end self-end" : "items-start self-start",
        )}
      >
        <div
          className={cn("flex items-center gap-3", userIsAuthor ? "flex-row" : "flex-row-reverse")}
        >
          <div className="mb-1 text-xs text-muted">{new Date(_creationTime).toLocaleTimeString(undefined, { timeStyle: 'short' })}</div>
          <div className="mb-1 text-sm font-medium">{author}</div>
        </div>

        <ContextMenuTrigger disabled={userId !== user?._id}>
          <div
            className={cn(
              "rounded-xl bg-muted px-3 py-2 transition-all",
              userIsAuthor ? "rounded-tr-none" : "rounded-tl-none",
            )}
            dangerouslySetInnerHTML={{ __html: sanitize(body) }}
          >
          </div>
        </ContextMenuTrigger>
      </li>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleEdit}>Edit</ContextMenuItem>
        <ContextMenuItem onClick={handleDelete}>Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu> 

  );
}
