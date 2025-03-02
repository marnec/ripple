import { UserContext } from "@/App";
import { useSanitize } from "@/hooks/use-sanitize";
import { cn } from "@/lib/utils";
import { useCreateBlockNote } from "@blocknote/react";
import { ContextMenuTrigger } from "@radix-ui/react-context-menu";
import { MessageWithAuthor } from "@shared/types/channel";
import { useContext, useEffect, useState } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuItem } from "../ui/context-menu";
import { useChatContext } from "./Chat";

type MessageProps = {
  message: MessageWithAuthor;
};

export function Message({ message }: MessageProps) {
  const { author, body, userId, _creationTime } = message;
  const [html, setHTML] = useState<string>("");
  const user = useContext(UserContext);
  const sanitize = useSanitize();

  const editor = useCreateBlockNote({ initialContent: JSON.parse(body) });
  const { setEditingMessage } = useChatContext()

  useEffect(() => {
    const onChange = async () => {
      const html = await editor.blocksToFullHTML(editor.document);
      setHTML(html);
    };
    onChange();
  }, []);

  return (
    <ContextMenu>
      <li
        className={cn(
          "flex flex-col text-sm",
          userId === user?._id ? "items-end self-end" : "items-start self-start",
        )}
      >
        <div
          className={cn("flex items-center gap-3", userId === user?._id ? "flex-row" : "flex-row-reverse")}
        >
          <div className="mb-1 text-xs text-muted">{new Date(_creationTime).toLocaleTimeString(undefined, { timeStyle: 'short' })}</div>
          <div className="mb-1 text-sm font-medium">{author}</div>
        </div>

        <ContextMenuTrigger >
          <div
            className={cn(
              "rounded-xl bg-muted px-3 py-2 transition-all",
              userId === user?._id ? "rounded-tr-none" : "rounded-tl-none",
            )}
            dangerouslySetInnerHTML={{ __html: sanitize(html) }}
          ></div>
        </ContextMenuTrigger>
      </li>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => setEditingMessage({ id: message._id, body: message.body })}>Edit</ContextMenuItem>
        <ContextMenuItem>Delete (coming soon)</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

  );
}
