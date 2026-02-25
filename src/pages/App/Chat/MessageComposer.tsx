import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { en } from '@blocknote/core/locales';
import { useCreateBlockNote, useEditorChange, useEditorSelectionChange, SuggestionMenuController } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import {
  CodeIcon,
  FontBoldIcon,
  FontItalicIcon,
  Link1Icon,
  StrikethroughIcon,
  UnderlineIcon,
} from "@radix-ui/react-icons";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../../components/ui/button";
import { Toggle } from "../../../components/ui/toggle";
import { useChatContext } from "./ChatContext";
import { TaskMention } from "./CustomInlineContent/TaskMention";
import { ResourceReference } from "./CustomInlineContent/ResourceReference";
import { ProjectReference } from "../Project/CustomInlineContent/ProjectReference";
import { UserMention } from "../Project/CustomInlineContent/UserMention";
import { MessageQuotePreview } from "./MessageQuotePreview";
import { File, FolderKanban, ImageIcon, PenTool, Phone, Table2, User, X } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { getUserDisplayName } from "@shared/displayName";
import { useUploadFile } from "../../../hooks/use-upload-file";

interface MessageComposerProps {
  handleSubmit: (content: string, plainText: string) => void;
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
  showCallButton?: boolean;
}

const editorIsEmpty = (editor: BlockNoteEditor<any, any, any>) => {
  const doc = editor._tiptapEditor.state.doc;
  // textContent only covers text nodes — also check for inline nodes (mentions, references)
  if (doc.textContent.trim().length > 0) return false;
  let hasInlineContent = false;
  doc.descendants((node) => {
    if (hasInlineContent) return false;
    if (node.isInline && !node.isText) {
      hasInlineContent = true;
      return false;
    }
  });
  return !hasInlineContent;
};

const editorClear = (editor: BlockNoteEditor<any, any, any>) => {
  editor.removeBlocks(editor.document.map((b) => b.id));
};

const { audio: _audio, heading: _heading, image: _image, ...remainingBlockSpecs } = defaultBlockSpecs;
const schema = BlockNoteSchema.create({
  blockSpecs: { ...remainingBlockSpecs },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    taskMention: TaskMention,
    projectReference: ProjectReference,
    resourceReference: ResourceReference,
    userMention: UserMention,
  },
});

const dictionary = {
  ...en,
  placeholders: {
    ...en.placeholders,
    default: "Ctrl+Enter to send",
  },
};

/** Extract plain text from BlockNote document JSON, including mention text */
function blocksToPlainText(
  blocks: any[],
  userNames: Map<string, string>,
  projectNames: Map<string, string>,
): string {
  const lines: string[] = [];
  for (const block of blocks) {
    let line = "";
    if (Array.isArray(block.content)) {
      for (const inline of block.content) {
        switch (inline.type) {
          case "text":
            line += inline.text;
            break;
          case "link":
            for (const c of inline.content || []) line += c.text;
            break;
          case "taskMention":
            line += `#${inline.props.taskTitle || "task"}`;
            break;
          case "userMention": {
            const name = userNames.get(inline.props.userId);
            line += `@${name || "user"}`;
            break;
          }
          case "projectReference": {
            const name = projectNames.get(inline.props.projectId);
            line += `#${name || "project"}`;
            break;
          }
          case "resourceReference":
            line += `#${inline.props.resourceName || "resource"}`;
            break;
        }
      }
    }
    lines.push(line);
    if (block.children?.length) {
      lines.push(blocksToPlainText(block.children, userNames, projectNames));
    }
  }
  return lines.join("\n").trim();
}

export const MessageComposer: React.FunctionComponent<MessageComposerProps> = ({
  handleSubmit,
  channelId: _channelId,
  workspaceId,
  showCallButton = true,
}: MessageComposerProps) => {
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const { editingMessage, replyingTo, setReplyingTo } = useChatContext();

  // Query projects for # autocomplete
  const projects = useQuery(api.projects.list, { workspaceId });

  // Query tasks for autocomplete
  const tasks = useQuery(api.tasks.listByWorkspace, { workspaceId, hideCompleted: true });

  // Query resources for # autocomplete
  const documents = useQuery(api.documents.list, { workspaceId });
  const diagrams = useQuery(api.diagrams.list, { workspaceId });
  const spreadsheets = useQuery(api.spreadsheets.list, { workspaceId });

  // Query workspace members for @ autocomplete
  const workspaceMembers = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const currentUser = useQuery(api.users.viewer);

  const uploadFile = useUploadFile(workspaceId);

  // Name lookup maps for mention text extraction (used in send + reply preview)
  const { userNames, projectNames } = useMemo(() => {
    const u = new Map<string, string>();
    workspaceMembers?.forEach(m => u.set(m._id, getUserDisplayName(m)));
    if (currentUser) u.set(currentUser._id, getUserDisplayName(currentUser));
    const p = new Map<string, string>();
    projects?.forEach(pr => p.set(pr._id, pr.name));
    return { userNames: u, projectNames: p };
  }, [workspaceMembers, currentUser, projects]);

  // Extract mention-aware text for reply preview
  const replyPreviewText = useMemo(() => {
    if (!replyingTo) return "";
    if (replyingTo.body) {
      try {
        return blocksToPlainText(JSON.parse(replyingTo.body), userNames, projectNames) || replyingTo.plainText;
      } catch { /* fall through */ }
    }
    return replyingTo.plainText;
  }, [replyingTo, userNames, projectNames]);

  const editorConfig = useMemo(
    () => ({
      schema,
      trailingBlock: false,
      dictionary,
    }),
    [],
  );

  // Attached image lives outside the editor — max one per message
  const [attachedImage, setAttachedImage] = useState<string | null>(null);

  useEffect(() => {
    if (!editor?._tiptapEditor?.isInitialized) return;

    editor._tiptapEditor.commands.clearContent();
    setAttachedImage(null);

    if (editingMessage.id && editingMessage.body) {
      const blocks: any[] = JSON.parse(editingMessage.body);
      // Extract image attachment from body (always first block if present)
      const imageBlock = blocks.find((b: any) => b.type === "image");
      if (imageBlock?.props?.url) {
        setAttachedImage(imageBlock.props.url);
      }
      const textBlocks = blocks.filter((b: any) => b.type !== "image");
      if (textBlocks.length > 0) {
        editor.replaceBlocks(editor.document, textBlocks);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMessage]);

  const editor = useCreateBlockNote(editorConfig);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAttachImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadFile) return;
    try {
      const url = await uploadFile(file);
      setAttachedImage(url);
    } catch (err) {
      console.error("Image upload failed:", err);
    }
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isStrike, setIsStrike] = useState(false);
  const [isCode, setIsCode] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  const canSend = !isEmpty || !!attachedImage;

  const sendMessage = () => {
    if (!canSend || !editor) return;
    const blocks: any[] = [...editor.document];
    if (attachedImage) {
      blocks.unshift({ type: "image", props: { url: attachedImage } });
    }
    const body = JSON.stringify(blocks);
    const plainText = blocksToPlainText(editor.document, userNames, projectNames);

    handleSubmit(body, plainText);
    editorClear(editor);
    setAttachedImage(null);
  };

  const updateActiveStyles = () => {
    if (!editor) return;
    const { bold, italic, underline, strike, code } = editor.getActiveStyles();
    setIsBold(!!bold);
    setIsItalic(!!italic);
    setIsStrike(!!strike);
    setIsUnderline(!!underline);
    setIsCode(!!code);
  };

  useEditorChange(() => {
    setIsEmpty(editorIsEmpty(editor));
    updateActiveStyles();
  }, editor);

  useEditorSelectionChange(() => {
    updateActiveStyles();
  }, editor);

  return (
    <div className="flex sm:flex-col flex-col-reverse p-2 pb-[calc(0.5rem+var(--safe-area-bottom))] max-w-full border-t gap-2">
      <div className="flex justify-between items-start">
        <div className="flex flex-row gap-2">
          <Toggle
            variant="outline"
            size="sm"
            pressed={isBold}
            title="Bold (Ctrl + B)"
            onClick={() => {
              editor.toggleStyles({ bold: true });
              editor.focus();
            }}
          >
            <FontBoldIcon className="h-4 w-4" />
          </Toggle>

          <Toggle
            variant="outline"
            size="sm"
            title="Italic (Ctrl + I)"
            pressed={isItalic}
            onClick={() => {
              editor.toggleStyles({ italic: true });
              editor.focus();
            }}
          >
            <FontItalicIcon />
          </Toggle>

          <Toggle
            variant="outline"
            size="sm"
            title="Underline (Ctrl + U)"
            pressed={isUnderline}
            onClick={() => {
              editor.toggleStyles({ underline: true });
              editor.focus();
            }}
          >
            <UnderlineIcon />
          </Toggle>

          <Toggle
            variant="outline"
            size="sm"
            title="Strikethrough (Ctrl + Shift + S)"
            pressed={isStrike}
            onClick={() => {
              editor.toggleStyles({ strike: true });
              editor.focus();
            }}
          >
            <StrikethroughIcon />
          </Toggle>

          <Toggle
            variant="outline"
            size="sm"
            title="Code (Ctrl + ?)"
            pressed={isCode}
            onClick={() => {
              editor.toggleStyles({ code: true });
              editor.focus();
            }}
          >
            <CodeIcon />
          </Toggle>

          <Button
            variant="outline"
            size="sm"
            title="Link (Ctrl + K)"
            onClick={() => {
              const text = editor.getSelectedText();
              const link = editor.getSelectedLinkUrl();
              editor.createLink(link ?? text, text);
              editor.focus();
            }}
          >
            <Link1Icon />
          </Button>

          <Button
            variant="outline"
            size="sm"
            title="Attach image"
            disabled={!uploadFile}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon className="h-4 w-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleAttachImage(e)}
          />
        </div>
        {showCallButton && (
          <Button variant="ghost" size="icon" onClick={() => void navigate("videocall")} title="Start a call">
            <Phone className="h-4 w-4" />
          </Button>
        )}
      </div>
      {replyingTo && (
        <MessageQuotePreview
          message={{
            author: replyingTo.author,
            plainText: replyPreviewText,
            deleted: false,
          }}
          onCancel={() => setReplyingTo(null)}
        />
      )}
      {attachedImage && (
        <div className="relative w-fit">
          <img src={attachedImage} alt="" className="max-h-32 rounded-md object-contain" />
          <button
            type="button"
            onClick={() => setAttachedImage(null)}
            className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <BlockNoteView
          id="message-composer"
          editor={editor}
          className="w-full grow min-w-0 box-border border rounded-md px-2 transition-shadow focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1"
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          sideMenu={false}
          emojiPicker={false}
          slashMenu={false}
          formattingToolbar={false}
          onKeyDownCapture={(event) => {
            if (!editor.getSelectedText()) {
              if (event.key === "b" && event.ctrlKey) setIsBold(!isBold);
              else if (event.key === "i" && event.ctrlKey) setIsItalic(!isItalic);
              else if (event.key === "u" && event.ctrlKey) setIsUnderline(!isUnderline);
              else if (event.key === "s" && event.ctrlKey && event.shiftKey) setIsStrike(!isStrike);
            }

            if (event.key === "Enter" && event.ctrlKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
        >
          <SuggestionMenuController
            triggerCharacter={"#"}
            getItems={async (query) => {
              const items: Array<{title: string; onItemClick: () => void; icon: React.JSX.Element; group: string}> = [];

              // Task mentions
              if (tasks) {
                tasks
                  .filter((task) =>
                    task.title.toLowerCase().includes(query.toLowerCase())
                  )
                  .slice(0, 7)
                  .forEach((task) => {
                    items.push({
                      title: task.title,
                      onItemClick: () => {
                        editor.insertInlineContent([
                          {
                            type: "taskMention",
                            props: {
                              taskId: task._id,
                              taskTitle: task.title,
                            },
                          },
                          " ",
                        ]);
                      },
                      icon: (
                        <div
                          className={cn(
                            "h-3 w-3 rounded-full",
                            task.status?.color || "bg-gray-500"
                          )}
                        />
                      ),
                      group: "Tasks",
                    });
                  });
              }

              // Project references
              if (projects) {
                projects
                  .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
                  .slice(0, 5)
                  .forEach((p) => {
                    items.push({
                      title: p.name,
                      onItemClick: () => {
                        editor.insertInlineContent([
                          { type: "projectReference", props: { projectId: p._id } },
                          " ",
                        ]);
                      },
                      icon: <FolderKanban className="h-4 w-4" />,
                      group: "Projects",
                    });
                  });
              }

              // Document references
              if (documents) {
                documents
                  .filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
                  .slice(0, 5)
                  .forEach((d) => {
                    items.push({
                      title: d.name,
                      onItemClick: () => {
                        editor.insertInlineContent([
                          { type: "resourceReference", props: { resourceId: d._id, resourceType: "document", resourceName: d.name } },
                          " ",
                        ]);
                      },
                      icon: <File className="h-4 w-4" />,
                      group: "Documents",
                    });
                  });
              }

              // Diagram references
              if (diagrams) {
                diagrams
                  .filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
                  .slice(0, 5)
                  .forEach((d) => {
                    items.push({
                      title: d.name,
                      onItemClick: () => {
                        editor.insertInlineContent([
                          { type: "resourceReference", props: { resourceId: d._id, resourceType: "diagram", resourceName: d.name } },
                          " ",
                        ]);
                      },
                      icon: <PenTool className="h-4 w-4" />,
                      group: "Diagrams",
                    });
                  });
              }

              // Spreadsheet references
              if (spreadsheets) {
                spreadsheets
                  .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
                  .slice(0, 5)
                  .forEach((s) => {
                    items.push({
                      title: s.name,
                      onItemClick: () => {
                        editor.insertInlineContent([
                          { type: "resourceReference", props: { resourceId: s._id, resourceType: "spreadsheet", resourceName: s.name } },
                          " ",
                        ]);
                      },
                      icon: <Table2 className="h-4 w-4" />,
                      group: "Spreadsheets",
                    });
                  });
              }

              return items;
            }}
          />
          <SuggestionMenuController
            triggerCharacter={"@"}
            getItems={async (query) => {
              if (!workspaceMembers || !currentUser) return [];

              return workspaceMembers
                .filter((m) =>
                  (m.name ?? "").toLowerCase().includes(query.toLowerCase())
                )
                .filter((m) => m._id !== currentUser._id)
                .slice(0, 10)
                .map((m) => ({
                  title: getUserDisplayName(m),
                  onItemClick: () => {
                    editor.insertInlineContent([
                      { type: "userMention", props: { userId: m._id } },
                      " ",
                    ]);
                  },
                  icon: <User className="h-4 w-4" />,
                  group: "Members",
                }));
            }}
          />
        </BlockNoteView>
        <Button disabled={!canSend} onClick={sendMessage} className="shrink-0 transition-transform active:scale-95">
          Send
        </Button>
      </div>
    </div>
  );
};
