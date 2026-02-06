import { UserContext } from "@/pages/App/UserContext";
import { cn } from "@/lib/utils";
import { MessageWithAuthor } from "@shared/types/channel";
import { useMutation } from "convex/react";
import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../../../components/ui/context-menu";
import { useChatContext } from "./ChatContext";
import { CreateTaskFromMessagePopover } from "./CreateTaskFromMessagePopover";
import { MessageRenderer } from "./MessageRenderer";

type MessageProps = {
  message: MessageWithAuthor;
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
  onTaskCreated: (taskId: Id<"tasks">, taskTitle: string) => void;
};

export function Message({ message, channelId, workspaceId, onTaskCreated }: MessageProps) {
  const { author, body, userId, _creationTime } = message;
  const user = useContext(UserContext);

  const userIsAuthor = userId === user?._id;
  const messageRef = useRef<HTMLLIElement>(null);
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  const { setEditingMessage } = useChatContext()
  const deleteMessage = useMutation(api.messages.remove)

  const handleEdit = useCallback(() => setEditingMessage({ id: message._id, body: message.body }), [message, setEditingMessage])
  const handleDelete = useCallback(() => void deleteMessage({ id: message._id }), [message, deleteMessage])
  const handleCreateTask = useCallback(() => setIsCreatingTask(true), [])

  const blocks = useMemo(() => JSON.parse(body), [body]);

  return (
    <>
      <ContextMenu>
        <li
          ref={messageRef}
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

          <ContextMenuTrigger>
            <div
              className={cn(
                "rounded-xl bg-muted px-3 py-2 transition-all",
                userIsAuthor ? "rounded-tr-none" : "rounded-tl-none"
              )}
            >
              <MessageRenderer blocks={blocks} />
            </div>
          </ContextMenuTrigger>
        </li>
        <ContextMenuContent>
          {userIsAuthor && (
            <>
              <ContextMenuItem onClick={handleEdit}>Edit</ContextMenuItem>
              <ContextMenuItem onClick={handleDelete}>Delete</ContextMenuItem>
            </>
          )}
          <ContextMenuItem onClick={handleCreateTask}>Create task from message</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isCreatingTask && (
        <CreateTaskFromMessagePopover
          message={message}
          channelId={channelId}
          workspaceId={workspaceId}
          open={isCreatingTask}
          onOpenChange={setIsCreatingTask}
          anchorRef={messageRef as React.RefObject<HTMLElement>}
          onTaskCreated={(taskId, taskTitle) => {
            onTaskCreated(taskId, taskTitle);
            setIsCreatingTask(false);
          }}
        />
      )}
    </>
  );
}
