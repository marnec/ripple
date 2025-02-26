import { cn } from "@/lib/utils";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useState } from "react";
import { Id } from "../../../convex/_generated/dataModel";
import { useSanitize } from "@/hooks/use-sanitize";

export function Message({
  author,
  authorName,
  viewer,
  content,
}: {
  author: Id<"users">;
  authorName: string;
  viewer: Id<"users">;
  content: string;
}) {
  const [html, setHTML] = useState<string>("");

  const sanitize = useSanitize();

  const editor = useCreateBlockNote({ initialContent: JSON.parse(content) });

  useEffect(() => {
    const onChange = async () => {
      const html = await editor.blocksToFullHTML(editor.document);
      setHTML(html);
    };
    onChange();
  }, []);

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
          "rounded-xl bg-muted px-3 py-2 transition-all",
          author === viewer ? "rounded-tr-none" : "rounded-tl-none",
        )}
        dangerouslySetInnerHTML={{ __html: sanitize(html) }}
      ></div>
    </li>
  );
}
