import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { SuggestionMenuController } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { getUserDisplayName } from "@shared/displayName";
import { FileText, PenTool } from "lucide-react";
import { useTheme } from "next-themes";

type TaskDescriptionEditorProps = {
  editor: any;
  onChange: () => void;
  documents?: Array<{ _id: string; name: string }>;
  diagrams?: Array<{ _id: string; name: string }>;
  members?: Array<{ userId: string; name?: string | null; image?: string }>;
  className?: string;
};

export function TaskDescriptionEditor({
  editor,
  onChange,
  documents,
  diagrams,
  members,
  className,
}: TaskDescriptionEditorProps) {
  const { resolvedTheme } = useTheme();

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground">
        Description
      </h3>
      <div
        className={cn(
          "task-description-editor border rounded-md p-4",
          className
        )}
      >
        <BlockNoteView
          editor={editor}
          onChange={onChange}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          sideMenu={false}
        >
          <SuggestionMenuController
            triggerCharacter={"#"}
            getItems={async (query) => {
              const items: Array<{
                title: string;
                onItemClick: () => void;
                icon: React.JSX.Element;
                group: string;
              }> = [];

              if (documents) {
                documents
                  .filter((doc) =>
                    doc.name.toLowerCase().includes(query.toLowerCase())
                  )
                  .slice(0, 5)
                  .forEach((doc) => {
                    items.push({
                      title: doc.name,
                      onItemClick: () => {
                        editor.insertInlineContent([
                          {
                            type: "documentLink",
                            props: { documentId: doc._id },
                          },
                          " ",
                        ]);
                      },
                      icon: <FileText className="h-4 w-4" />,
                      group: "Documents",
                    });
                  });
              }

              if (diagrams) {
                diagrams
                  .filter((d) =>
                    d.name.toLowerCase().includes(query.toLowerCase())
                  )
                  .slice(0, 5)
                  .forEach((d) => {
                    items.push({
                      title: d.name,
                      onItemClick: () => {
                        editor.insertInlineContent([
                          {
                            type: "diagramEmbed",
                            props: { diagramId: d._id },
                          },
                          " ",
                        ]);
                      },
                      icon: <PenTool className="h-4 w-4" />,
                      group: "Diagrams",
                    });
                  });
              }

              return items;
            }}
          />
          <SuggestionMenuController
            triggerCharacter={"@"}
            getItems={async (query) => {
              if (!members) return [];
              return members
                .filter((m) =>
                  m.name?.toLowerCase().includes(query.toLowerCase())
                )
                .slice(0, 10)
                .map((m) => ({
                  title: getUserDisplayName(m),
                  onItemClick: () => {
                    editor.insertInlineContent([
                      {
                        type: "userMention",
                        props: { userId: m.userId },
                      },
                      " ",
                    ]);
                  },
                  icon: (
                    <Avatar className="h-5 w-5">
                      {m.image && <AvatarImage src={m.image} />}
                      <AvatarFallback className="text-xs">
                        {m.name?.slice(0, 2).toUpperCase() ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                  ),
                  group: "Project members",
                }));
            }}
          />
        </BlockNoteView>
      </div>
    </div>
  );
}
