import { cn } from "@/lib/utils";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { Id } from "../../../convex/_generated/dataModel";

export function Message({
  author,
  authorName,
  viewer,
  content
}: {
  author: Id<"users">;
  authorName: string;
  viewer: Id<"users">;
  content: string;
}) {
  const messageRenderer = useCreateBlockNote({ initialContent: JSON.parse(content) })

  return (
    <li
      className={cn(
        "flex flex-col text-sm",
        author === viewer ? "items-end self-end" : "items-start self-start",
      )}
    >
      <div className="mb-1 text-sm font-medium">{authorName}</div>
      <div
        className={cn(
          "rounded-xl bg-muted px-3 py-2",
          author === viewer ? "rounded-tr-none" : "rounded-tl-none",
        )}
      >
        <BlockNoteView editor={messageRenderer} editable={false} />
      </div>
    </li>
  );
}
