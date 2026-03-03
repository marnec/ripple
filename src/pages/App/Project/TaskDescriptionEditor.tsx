import { cn } from "@/lib/utils";
import { SuggestionMenuController } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { FileText, PenTool } from "lucide-react";
import { useMutation } from "convex/react";
import { useCallback, useState } from "react";
import { useTheme } from "next-themes";
import { useMemberSuggestions } from "../../../hooks/use-member-suggestions";
import { BlockPickerDialog } from "../Document/BlockPickerDialog";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

type TaskDescriptionEditorProps = {
  editor: any;
  documents?: Array<{ _id: string; name: string }>;
  diagrams?: Array<{ _id: string; name: string }>;
  members?: Array<{ userId: string; name?: string | null; image?: string }>;
  className?: string;
  hideLabel?: boolean;
};

export function TaskDescriptionEditor({
  editor,
  documents,
  diagrams,
  members,
  className,
  hideLabel,
}: TaskDescriptionEditorProps) {
  const { resolvedTheme } = useTheme();
  const ensureBlockRef = useMutation(api.documentBlockRefs.ensureBlockRef);

  const [blockPickerDialog, setBlockPickerDialog] = useState<{
    open: boolean;
    documentId: Id<"documents">;
    documentName: string;
  } | null>(null);

  const getMemberItems = useMemberSuggestions({
    members,
    editor,
    group: "Project members",
  });

  const handleBlockPickerInsert = useCallback(
    (blockId: string) => {
      if (!editor || !blockPickerDialog) return;

      const { documentId } = blockPickerDialog;
      editor.focus();

      editor.insertBlocks(
        [
          {
            type: "documentBlockEmbed",
            props: { documentId, blockId },
          },
        ],
        editor.getTextCursorPosition().block,
        "after",
      );

      void ensureBlockRef({ documentId, blockId });
      setBlockPickerDialog(null);
    },
    [editor, blockPickerDialog, ensureBlockRef],
  );

  if (!editor) {
    return <div className={className} />;
  }

  return (
    <div className={hideLabel ? undefined : "space-y-2"}>
      {!hideLabel && (
        <h3 className="text-sm font-semibold text-muted-foreground">
          Description
        </h3>
      )}
      <div
        className={cn(
          "task-description-editor border rounded-md p-4 animate-fade-in",
          className
        )}
      >
        <BlockNoteView
          editor={editor}
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
                        setBlockPickerDialog({
                          open: true,
                          documentId: doc._id as Id<"documents">,
                          documentName: doc.name,
                        });
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
                        editor.insertBlocks(
                          [
                            {
                              type: "diagram",
                              props: { diagramId: d._id },
                            },
                          ],
                          editor.getTextCursorPosition().block,
                          "after"
                        );
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
            getItems={getMemberItems}
          />
        </BlockNoteView>
      </div>
      {blockPickerDialog && (
        <BlockPickerDialog
          open={blockPickerDialog.open}
          onOpenChange={(open) => {
            if (!open) setBlockPickerDialog(null);
          }}
          documentId={blockPickerDialog.documentId}
          documentName={blockPickerDialog.documentName}
          onInsert={handleBlockPickerInsert}
        />
      )}
    </div>
  );
}
