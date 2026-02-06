import { UserContext } from "@/pages/App/UserContext";
import { cn } from "@/lib/utils";
import { MessageWithAuthor } from "@shared/types/channel";
import { useMutation } from "convex/react";
import { useCallback, useContext } from "react";
import { api } from "../../../../convex/_generated/api";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../../../components/ui/context-menu";
import { useChatContext } from "./ChatContext";
import { SafeHtml } from "@/components/ui/safe-html";

type MessageProps = {
  message: MessageWithAuthor;
};

export function Message({ message }: MessageProps) {
  const { author, body, userId, _creationTime } = message;
  const user = useContext(UserContext);
  
  const userIsAuthor = userId === user?._id;

  const { setEditingMessage } = useChatContext()
  const deleteMessage = useMutation(api.messages.remove)

  const handleEdit = useCallback(() => setEditingMessage({ id: message._id, body: message.body }), [message, setEditingMessage])
  const handleDelete = useCallback(() => void deleteMessage({ id: message._id }), [message, deleteMessage])

  return (
    <ContextMenu>
      <li
        className={cn(
          "flex flex-col text-sm animate-slide-up",
          userIsAuthor ? "items-end self-end" : "items-start self-start",
        )}
      >
        <div
          className={cn("flex items-center gap-3", userIsAuthor ? "flex-row" : "flex-row-reverse")}
        >
          <div className="mb-1 text-xs text-muted-foreground/70">{new Date(_creationTime).toLocaleTimeString(undefined, { timeStyle: 'short' })}</div>
          <div className="mb-1 text-sm font-medium">{author}</div>
        </div>

        <ContextMenuTrigger disabled={userId !== user?._id}>
          <SafeHtml
            html={body}
            className={cn(
              "rounded-xl bg-muted px-3 py-2 transition-all",
              userIsAuthor ? "rounded-tr-none" : "rounded-tl-none"
            )}
          />
        </ContextMenuTrigger>
      </li>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleEdit}>Edit</ContextMenuItem>
        <ContextMenuItem onClick={handleDelete}>Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu> 

  );
}
