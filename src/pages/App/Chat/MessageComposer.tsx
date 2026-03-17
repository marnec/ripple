import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import { en } from '@blocknote/core/locales';
import { useCreateBlockNote, useEditorChange, SuggestionMenuController } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../../components/ui/button";
import { useChatContext } from "./ChatContext";
import { TaskMention } from "./CustomInlineContent/TaskMention";
import { ResourceReference } from "./CustomInlineContent/ResourceReference";
import { ProjectReference } from "../Project/CustomInlineContent/ProjectReference";
import { UserMention } from "../Project/CustomInlineContent/UserMention";
import { MessageQuotePreview } from "./MessageQuotePreview";
import { Command, CornerDownLeft, File, FolderKanban, PenTool, Phone, SendHorizonal, Table2, X } from "lucide-react";
import { RippleSpinner } from "../../../components/RippleSpinner";
import { useWorkspaceSidebar } from "@/contexts/WorkspaceSidebarContext";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { getUserDisplayName } from "@shared/displayName";
import { useUploadFile, type ImageUploadResult } from "../../../hooks/use-upload-file";
import { useMemberSuggestions } from "../../../hooks/use-member-suggestions";
import { isEditorEmpty, editorClear, blocksToPlainText } from "@/lib/editor-utils";
import { FormattingToolbar } from "./FormattingToolbar";
import { Kbd } from "../../../components/ui/kbd";

interface MessageComposerProps {
  handleSubmit: (content: string, plainText: string) => void;
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
  showCallButton?: boolean;
}

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

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

const dictionary = {
  ...en,
  placeholders: {
    ...en.placeholders,
    default: "Type a message... # refs, @ mentions",
  },
};

export const MessageComposer: React.FunctionComponent<MessageComposerProps> = ({
  handleSubmit,
  channelId: _channelId,
  workspaceId,
  showCallButton = true,
}: MessageComposerProps) => {
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const { editingMessage, replyingTo, setReplyingTo } = useChatContext();

  const sidebarData = useWorkspaceSidebar();
  const projects = sidebarData?.projects;
  const documents = sidebarData?.documents;
  const diagrams = sidebarData?.diagrams;
  const spreadsheets = sidebarData?.spreadsheets;
  const tasks = useQuery(api.tasks.listByWorkspace, { workspaceId, hideCompleted: true });
  const workspaceMembers = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const currentUser = useQuery(api.users.viewer);

  const fileUpload = useUploadFile(workspaceId);

  const { userNames, projectNames } = useMemo(() => {
    const u = new Map<string, string>();
    workspaceMembers?.forEach(m => u.set(m._id, getUserDisplayName(m)));
    if (currentUser) u.set(currentUser._id, getUserDisplayName(currentUser));
    const p = new Map<string, string>();
    projects?.forEach(pr => p.set(pr._id, pr.name));
    return { userNames: u, projectNames: p };
  }, [workspaceMembers, currentUser, projects]);

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

  // Image state: local blob preview + uploaded URLs (thumbnail + full)
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<ImageUploadResult | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  const editor = useCreateBlockNote(editorConfig);

  // Restore editor content when editing an existing message
  useEffect(() => {
    if (!editor?._tiptapEditor?.isInitialized) return;
    editor._tiptapEditor.commands.clearContent();
    setImagePreview(null);
    setImageUrls(null);
    setIsUploadingImage(false);

    if (editingMessage.id && editingMessage.body) {
      const blocks: any[] = JSON.parse(editingMessage.body);
      const imageBlock = blocks.find((b: any) => b.type === "image");
      if (imageBlock?.props?.url) {
        const url = imageBlock.props.url as string;
        const fullUrl = (imageBlock.props.fullUrl as string) || url;
        setImagePreview(url);
        setImageUrls({ url, fullUrl });
      }
      const textBlocks = blocks.filter((b: any) => b.type !== "image");
      if (textBlocks.length > 0) {
        editor.replaceBlocks(editor.document, textBlocks);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMessage]);

  const hasImage = !!imagePreview;
  const canSend = (!isEmpty || !!imageUrls) && !isUploadingImage;

  const clearImage = useCallback(() => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setImageUrls(null);
    setIsUploadingImage(false);
  }, [imagePreview]);

  const handleImagePreview = useCallback((blobUrl: string) => {
    setImagePreview(blobUrl);
    setIsUploadingImage(true);
  }, []);

  const handleImageReady = useCallback((urls: ImageUploadResult) => {
    setImageUrls(urls);
    setIsUploadingImage(false);
  }, []);

  const handleImageUploadFailed = useCallback(() => {
    clearImage();
  }, [clearImage]);

  const getMemberItems = useMemberSuggestions({
    members: workspaceMembers,
    editor,
    excludeUserId: currentUser?._id,
  });

  const getResourceItems = useMemo(() => {
    return async (query: string) => {
      const q = query.toLowerCase();
      const items: Array<{title: string; onItemClick: () => void; icon: React.JSX.Element; group: string}> = [];

      tasks?.filter(t => t.title.toLowerCase().includes(q)).slice(0, 7).forEach(task => {
        items.push({
          title: task.title,
          onItemClick: () => {
            editor.insertInlineContent([
              { type: "taskMention", props: { taskId: task._id, taskTitle: task.title } },
              " ",
            ]);
          },
          icon: <div className={cn("h-3 w-3 rounded-full", task.status?.color || "bg-gray-500")} />,
          group: "Tasks",
        });
      });

      projects?.filter(p => p.name.toLowerCase().includes(q)).slice(0, 5).forEach(p => {
        items.push({
          title: p.name,
          onItemClick: () => {
            editor.insertInlineContent([{ type: "projectReference", props: { projectId: p._id } }, " "]);
          },
          icon: <FolderKanban className="h-4 w-4" />,
          group: "Projects",
        });
      });

      documents?.filter(d => d.name.toLowerCase().includes(q)).slice(0, 5).forEach(d => {
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

      diagrams?.filter(d => d.name.toLowerCase().includes(q)).slice(0, 5).forEach(d => {
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

      spreadsheets?.filter(s => s.name.toLowerCase().includes(q)).slice(0, 5).forEach(s => {
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

      return items;
    };
  }, [tasks, projects, documents, diagrams, spreadsheets, editor]);

  const sendMessage = () => {
    if (!canSend || !editor) return;
    const blocks: any[] = [...editor.document];
    if (imageUrls) {
      blocks.unshift({ type: "image", props: { url: imageUrls.url, fullUrl: imageUrls.fullUrl } });
    }
    const body = JSON.stringify(blocks);
    const plainText = blocksToPlainText(editor.document, userNames, projectNames);

    handleSubmit(body, plainText);
    editorClear(editor);
    clearImage();
  };

  useEditorChange(() => {
    setIsEmpty(isEditorEmpty(editor));
  }, editor);

  return (
    <div className="flex shrink-0 sm:flex-col flex-col-reverse p-2 pb-[calc(0.5rem+var(--safe-area-bottom))] max-w-full border-t gap-2">
      <div className="flex justify-between items-center">
        <FormattingToolbar
          editor={editor}
          uploadImageWithThumbnail={fileUpload?.uploadImageWithThumbnail}
          onImagePreview={handleImagePreview}
          onImageReady={handleImageReady}
          onImageUploadFailed={handleImageUploadFailed}
        />
        {showCallButton && (
          <Button variant="ghost" size="icon" onClick={() => void navigate("videocall")} title="Start a call" className="sm:w-18 sm:gap-1.5 sm:px-3">
            <Phone className="h-4 w-4" />
            <span className="hidden sm:inline text-sm">Join</span>
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
      {hasImage && (
        <div className="relative w-fit">
          <img src={imagePreview} alt="" className="max-h-32 rounded-md object-contain" />
          {isUploadingImage && (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/60">
              <RippleSpinner size={32} />
            </div>
          )}
          <button
            type="button"
            onClick={clearImage}
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
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              sendMessage();
            }
          }}
        >
          <SuggestionMenuController triggerCharacter={"#"} getItems={getResourceItems} />
          <SuggestionMenuController triggerCharacter={"@"} getItems={getMemberItems} />
        </BlockNoteView>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button disabled={!canSend} onClick={sendMessage} size="icon" className="sm:w-18 sm:gap-1.5 sm:px-3 transition-transform active:scale-95">
            <SendHorizonal className="h-4 w-4" />
            <span className="hidden sm:inline text-sm">Send</span>
          </Button>
          <div className="hidden sm:flex items-center gap-0.5">
            <Kbd>{isMac ? <Command /> : "Ctrl"}</Kbd>
            <Kbd><CornerDownLeft /></Kbd>
          </div>
        </div>
      </div>
    </div>
  );
};
