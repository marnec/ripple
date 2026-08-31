import { BlockNoteSchema, defaultInlineContentSpecs } from "@blocknote/core";
import { shortFormBlockSpecs } from "@/lib/blocknote/short-form-schema";
import "@blocknote/core/fonts/inter.css";
import { en } from "@blocknote/core/locales";
import { useCreateBlockNote, useEditorChange, SuggestionMenuController } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useTheme } from "next-themes";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConvex } from "convex/react";
import { toast } from "sonner";
import { Button } from "@ripple/ui/components/button";
import { useChatContext } from "./ChatContext";
import { TaskMention } from "./CustomInlineContent/TaskMention";
import { ResourceReference } from "./CustomInlineContent/ResourceReference";
import { EventMention } from "./CustomInlineContent/EventMention";
import { ProjectReference } from "../Project/CustomInlineContent/ProjectReference";
import { UserMention } from "./CustomInlineContent/UserMention";
import { MessageQuotePreview } from "./MessageQuotePreview";
import { EditingBanner } from "./EditingBanner";
import {
  Check,
  Command,
  CornerDownLeft,
  File,
  Paperclip,
  Phone,
  SendHorizonal,
  X,
} from "lucide-react";
import { RippleSpinner } from "../../../components/RippleSpinner";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";
import { useViewer } from "../UserContext";
import type { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { getUserDisplayName } from "@ripple/shared/displayName";
import { useUploadFile, type ImageUploadResult } from "../../../hooks/use-upload-file";
import { MESSAGE_FILE_ATTACHMENT_MAX_BYTES, formatFileSize } from "@shared/constants";
import { useMemberSuggestions } from "../../../hooks/use-member-suggestions";
import { useEventSuggestions } from "../../../hooks/use-event-suggestions";
import { useResourceSuggestions } from "../../../hooks/use-resource-suggestions";
import { useTaskSuggestions } from "../../../hooks/use-task-suggestions";
import { isEditorEmpty, editorClear, blocksToPlainText } from "@/lib/editor-utils";
import { attachmentKindFor } from "./messageUtils";
import { buildTableContent } from "@/lib/spreadsheet-table";
import { trimSnapshotRange } from "@/lib/spreadsheet-snapshot";
import { parseRange } from "@ripple/shared/cellRef";
import { generateThumbnail } from "@/lib/image-thumbnail";
import {
  fetchDiagramSnapshotBlob,
  EmptyDiagramSnapshotError,
  MissingDiagramSnapshotError,
} from "@/lib/exporters/diagram-snapshot";
import { FormattingToolbar } from "./FormattingToolbar";
import { Kbd } from "../../../components/ui/kbd";

// Heavy (pulls Excalidraw for the frame thumbnails) — load only when a user
// actually picks a diagram to snapshot, keeping it out of the chat entry chunk.
const FramePickerDialog = lazy(() =>
  import("../Document/FramePickerDialog").then((m) => ({ default: m.FramePickerDialog })),
);

// Also heavy (opens a collaborative room, and its picker pulls jspreadsheet) —
// loaded only when a user actually picks a spreadsheet to reference.
const SpreadsheetRangeDialog = lazy(() =>
  import("./SpreadsheetRangeDialog").then((m) => ({ default: m.SpreadsheetRangeDialog })),
);

interface MessageComposerProps {
  handleSubmit: (content: string, plainText: string) => void;
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
  showCallButton?: boolean;
}

const schema = BlockNoteSchema.create({
  blockSpecs: { ...shortFormBlockSpecs() },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    taskMention: TaskMention,
    projectReference: ProjectReference,
    resourceReference: ResourceReference,
    userMention: UserMention,
    eventMention: EventMention,
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
  channelId,
  workspaceId,
  showCallButton = true,
}: MessageComposerProps) => {
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const { editingMessage, setEditingMessage, replyingTo, setReplyingTo, attachDroppedFilesRef } =
    useChatContext();
  const isEditing = !!editingMessage.id;

  // Only the reply-preview's plain-text rendering needs project names up front
  // (`#name` for a projectReference chip); the `#` picker itself is
  // search-backed. `projects.list` is one small workspace-scoped table, shared
  // with the rest of the app through the cached `useQuery`.
  const projects = useQuery(api.projects.list, { workspaceId });
  const workspaceMembers = useWorkspaceMembers();
  const currentUser = useViewer();

  const fileUpload = useUploadFile(workspaceId);
  const convex = useConvex();

  const { userNames, projectNames } = useMemo(() => {
    const u = new Map<string, string>();
    workspaceMembers?.forEach((m) => u.set(m._id, getUserDisplayName(m)));
    if (currentUser) u.set(currentUser._id, getUserDisplayName(currentUser));
    const p = new Map<string, string>();
    projects?.forEach((pr) => p.set(pr._id, pr.name));
    return { userNames: u, projectNames: p };
  }, [workspaceMembers, currentUser, projects]);

  const replyPreviewText = useMemo(() => {
    if (!replyingTo) return "";
    if (replyingTo.body) {
      try {
        return (
          blocksToPlainText(JSON.parse(replyingTo.body), userNames, projectNames) ||
          replyingTo.plainText
        );
      } catch {
        /* fall through */
      }
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

  // Image state: local blob preview + uploaded URLs (thumbnail + full).
  // Dimensions are optional here only because editing a pre-dimensions message
  // rehydrates this state from a body that has none; fresh uploads always carry them.
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<
    | (Omit<ImageUploadResult, "width" | "height"> & { width?: number; height?: number })
    | null
  >(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  // When the attached image is a diagram snapshot, carry the source so the
  // sent message can deep-link back to the live diagram (click-to-open).
  const [imageDiagram, setImageDiagram] = useState<{ id: Id<"diagrams">; name: string } | null>(
    null,
  );
  // Target diagram for the frame picker; null when the picker is closed.
  const [framePickerTarget, setFramePickerTarget] = useState<{
    id: Id<"diagrams">;
    name: string;
  } | null>(null);
  // True while capturing/exporting a snapshot, before the preview blob exists.
  const [isCapturingSnapshot, setIsCapturingSnapshot] = useState(false);
  // A non-image attachment. One slot, and it is the *same* slot the image
  // occupies conceptually — a message carries at most one attachment, so
  // attaching a file clears a pending image and vice versa. `url === null` is
  // the mid-upload state; the send button waits on it.
  const [fileAttachment, setFileAttachment] = useState<{
    name: string;
    size: number;
    mimeType: string;
    url: string | null;
  } | null>(null);
  // Bumped by every clear and every new pick, so an upload that resolves after
  // the user removed (or replaced) its attachment drops its result instead of
  // resurrecting it.
  const fileUploadToken = useRef(0);
  // Target spreadsheet for the range dialog; null when it's closed.
  const [rangeTarget, setRangeTarget] = useState<{
    id: Id<"spreadsheets">;
    name: string;
  } | null>(null);

  const editor = useCreateBlockNote(editorConfig);

  // Reset image state synchronously when the edit target changes — keeps
  // image fields in lockstep with `editingMessage` without an effect.
  const [prevEditingId, setPrevEditingId] = useState(editingMessage.id);
  if (prevEditingId !== editingMessage.id) {
    setPrevEditingId(editingMessage.id);
    setImagePreview(null);
    setImageUrls(null);
    setIsUploadingImage(false);
    setImageDiagram(null);
    setIsCapturingSnapshot(false);
    setFileAttachment(null);
    if (editingMessage.id && editingMessage.body) {
      try {
        const blocks: any[] = JSON.parse(editingMessage.body);
        const fileBlock = blocks.find((b: any) => b.type === "file");
        if (fileBlock?.props?.url) {
          setFileAttachment({
            url: fileBlock.props.url as string,
            name: (fileBlock.props.name as string) || "attachment",
            mimeType: (fileBlock.props.mimeType as string) || "",
            size: (fileBlock.props.size as number) || 0,
          });
        }
        const imageBlock = blocks.find((b: any) => b.type === "image");
        if (imageBlock?.props?.url) {
          const url = imageBlock.props.url as string;
          const fullUrl = (imageBlock.props.fullUrl as string) || url;
          setImagePreview(url);
          // Messages sent before image dimensions were recorded have no
          // width/height — re-sending keeps them absent rather than guessing.
          setImageUrls({
            url,
            fullUrl,
            width: imageBlock.props.width as number | undefined,
            height: imageBlock.props.height as number | undefined,
          });
          if (imageBlock.props.diagramId) {
            setImageDiagram({
              id: imageBlock.props.diagramId as Id<"diagrams">,
              name: (imageBlock.props.diagramName as string) || "",
            });
          }
        }
      } catch {
        /* malformed body — leave image state cleared */
      }
    }
  }

  // Editor content manipulation must run after editor init — stays in effect.
  // The token bump rides along here rather than in the synchronous reset above
  // because a ref may not be touched during render; the effect is the first
  // moment after an edit-target switch where it can be invalidated.
  useEffect(() => {
    fileUploadToken.current++;
    if (!editor?._tiptapEditor?.isInitialized) return;
    editor._tiptapEditor.commands.clearContent();
    if (editingMessage.id && editingMessage.body) {
      try {
        const blocks: any[] = JSON.parse(editingMessage.body);
        const textBlocks = blocks.filter((b: any) => b.type !== "image" && b.type !== "file");
        if (textBlocks.length > 0) {
          editor.replaceBlocks(editor.document, textBlocks);
        }
      } catch {
        /* malformed body — leave editor cleared */
      }
      editor.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMessage]);

  const hasImage = !!imagePreview;
  const isUploadingFile = !!fileAttachment && fileAttachment.url === null;
  const canSend =
    (!isEmpty || !!imageUrls || !!fileAttachment?.url) &&
    !isUploadingImage &&
    !isCapturingSnapshot &&
    !isUploadingFile;

  const clearFile = useCallback(() => {
    fileUploadToken.current++;
    setFileAttachment(null);
  }, []);

  const clearImage = useCallback(() => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setImageUrls(null);
    setIsUploadingImage(false);
    setImageDiagram(null);
    setIsCapturingSnapshot(false);
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

  // Shared image-attachment flow used by both the toolbar's file picker and
  // clipboard paste: show a local preview immediately, upload in the
  // background, then swap in the hosted URLs.
  const attachImageFile = async (file: File) => {
    if (!fileUpload) return;
    clearFile();
    try {
      const { thumbnail, previewUrl, isOriginal, width, height } = await generateThumbnail(file);
      handleImagePreview(previewUrl);
      const urls = await fileUpload.uploadImageWithThumbnail(file, thumbnail, isOriginal, {
        width,
        height,
      });
      handleImageReady(urls);
    } catch (err) {
      console.error("Image upload failed:", err);
      handleImageUploadFailed();
    }
  };

  // The non-image counterpart: no thumbnail leg and no local preview to
  // revoke, so the card renders from the picked file's own metadata while the
  // blob uploads and only the URL arrives later.
  const attachFile = async (file: File) => {
    if (!fileUpload) return;
    if (file.size > MESSAGE_FILE_ATTACHMENT_MAX_BYTES) {
      toast.error(
        `That file is too large (max ${formatFileSize(MESSAGE_FILE_ATTACHMENT_MAX_BYTES)}).`,
      );
      return;
    }
    clearImage();
    clearFile();
    const token = fileUploadToken.current;
    setFileAttachment({
      name: file.name || "attachment",
      size: file.size,
      mimeType: file.type,
      url: null,
    });
    try {
      const uploaded = await fileUpload.uploadAttachment(file);
      if (fileUploadToken.current !== token) return;
      setFileAttachment(uploaded);
    } catch (err) {
      if (fileUploadToken.current !== token) return;
      console.error("File upload failed:", err);
      toast.error("Couldn't upload that file.");
      setFileAttachment(null);
    }
  };

  // Paste a file straight from the clipboard. Runs in the capture phase
  // (see onPasteCapture below) so it intercepts the file before BlockNote
  // tries to handle the paste. Ignored while another upload is in flight to
  // avoid racing two uploads into the single attachment slot.
  //
  // Images keep taking the image route (thumbnail + full, inline render);
  // anything else becomes a file attachment. A clipboard payload carrying
  // both is an image paste — that is what "copy image" produces, and the
  // text/plain leg beside it is not a file item at all.
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const fileItems = Array.from(items).filter((it) => it.kind === "file");
    if (fileItems.length === 0) return;
    const item =
      fileItems.find((it) => attachmentKindFor(it.type) === "image") ?? fileItems[0];
    e.preventDefault();
    e.stopPropagation();
    if (!fileUpload || isUploadingImage || isCapturingSnapshot || isUploadingFile) return;
    const file = item.getAsFile();
    if (!file) return;
    if (attachmentKindFor(item.type) === "image") void attachImageFile(file);
    else void attachFile(file);
  };

  // Files dropped anywhere on the chat pane (the drop zone itself is in
  // `Chat`, which owns the pane). Routing is by MIME: an image goes down the
  // image path — local preview, thumbnail, inline render — and everything else
  // becomes a file attachment.
  const attachDroppedFiles = (files: File[]) => {
    const [file, ...rest] = files;
    if (!file) return;
    if (!fileUpload) return;
    if (isUploadingImage || isUploadingFile || isCapturingSnapshot) {
      toast.error("Wait for the current attachment to finish uploading.");
      return;
    }
    // One attachment per message, so a multi-file drop is not silently
    // truncated — say which one was taken.
    if (rest.length > 0) {
      toast.info(`A message carries one attachment — attaching ${file.name}.`);
    }
    if (attachmentKindFor(file.type) === "image") void attachImageFile(file);
    else void attachFile(file);
  };

  // Republished on every render rather than once on mount: the handler closes
  // over the upload flags it guards on, and a mount-only registration would
  // freeze them at their initial `false`.
  useEffect(() => {
    attachDroppedFilesRef.current = attachDroppedFiles;
    return () => {
      attachDroppedFilesRef.current = null;
    };
  });

  // Snapshot a diagram (whole canvas or a single frame) into a static PNG and
  // hand it to the shared image-attachment lifecycle. The sent message keeps
  // `diagramId`/`diagramName` on the image block so it stays click-to-open.
  const captureDiagramSnapshot = async (
    diagram: { id: Id<"diagrams">; name: string },
    frameId: string | null,
  ) => {
    if (!fileUpload) return;
    clearFile();
    setIsCapturingSnapshot(true);
    try {
      const blob = await fetchDiagramSnapshotBlob(convex, diagram.id, frameId);
      // `File` here is the lucide icon import — use the DOM constructor.
      const file = new globalThis.File([blob], `${diagram.name || "diagram"}.png`, {
        type: "image/png",
      });
      const { thumbnail, previewUrl, isOriginal, width, height } = await generateThumbnail(file);
      // Switch from the "capturing" indicator to the normal image preview.
      setIsCapturingSnapshot(false);
      handleImagePreview(previewUrl);
      setImageDiagram(diagram);
      const urls = await fileUpload.uploadImageWithThumbnail(file, thumbnail, isOriginal, {
        width,
        height,
      });
      handleImageReady(urls);
    } catch (err) {
      if (err instanceof MissingDiagramSnapshotError) {
        toast.error("That diagram has no saved content to snapshot yet.");
      } else if (err instanceof EmptyDiagramSnapshotError) {
        toast.error("That diagram is empty — nothing to snapshot.");
      } else {
        console.error("Diagram snapshot failed:", err);
        toast.error("Couldn't capture the diagram snapshot.");
      }
      clearImage();
    }
  };

  // A spreadsheet reference resolves to one of two things, exactly as it does
  // in a document: a blank range is the chip alone, and a real range is that
  // chip followed by a frozen table of the cells. The table is ordinary
  // BlockNote content — the chat schema keeps the `table` block, so it round
  // trips through send, render and edit with nothing added.
  const insertSpreadsheetRange = (
    spreadsheet: { id: Id<"spreadsheets">; name: string },
    cellRef: string | null,
    values: string[][] | null,
  ) => {
    if (!editor) return;

    // A dragged selection routinely overshoots the data by a row or two, and a
    // frozen copy has no way to grow back into those cells later — so the blank
    // rim is dropped here and the chip names what actually survived. A range
    // that was blank all the way through trims to nothing and falls through to
    // the chip-only branch, which beats sending a grid of empty boxes.
    const trimmed =
      cellRef && values ? trimSnapshotRange(values, cellRef) : null;

    const chip = {
      type: "resourceReference" as const,
      props: {
        resourceId: spreadsheet.id,
        resourceType: "spreadsheet",
        resourceName: spreadsheet.name,
        // Nothing else in the message states which cells these are — the
        // header gutter is off — so the chip carries the range.
        cellRef: trimmed?.cellRef ?? cellRef ?? "",
      },
    };

    const range = trimmed ? parseRange(trimmed.cellRef) : null;
    if (!trimmed || !range) {
      editor.insertInlineContent([chip, " "]);
      return;
    }

    editor.insertInlineContent([chip]);
    const content = buildTableContent({
      values: trimmed.values,
      rowCount: trimmed.values.length,
      colCount: trimmed.values[0].length,
      startCol: range.startCol,
      startRow: range.startRow,
      // Coordinates belong on a live embed you can go and point at; a frozen
      // copy in a channel is just the data, and the chip above already says
      // where it came from.
      showHeaders: false,
    });
    // Deferred for the same reason the document's clone-as-table is: inserting
    // a table synchronously re-enters BlockNote's table plugin mid-update.
    setTimeout(() => {
      editor.insertBlocks(
        [{ type: "table" as const, content }],
        editor.getTextCursorPosition().block,
        "after",
      );
    }, 0);
  };

  const getMemberItems = useMemberSuggestions({
    members: workspaceMembers,
    editor,
    excludeUserId: currentUser?._id,
  });

  const getEventItems = useEventSuggestions({ workspaceId, editor });

  // Combine members + events under a single `@` trigger. Members render
  // first (existing behaviour); events are grouped under "Upcoming" / "Recent".
  const getAtMentionItems = useMemo(() => {
    return async (query: string) => {
      const [members, events] = await Promise.all([getMemberItems(query), getEventItems(query)]);
      return [...members, ...events];
    };
  }, [getMemberItems, getEventItems]);

  // `#` offers tasks first, then the four workspace resource groups. Both
  // legs search server-side per keystroke (see the hooks) — this used to
  // client-filter every open task plus four whole workspace tables held live
  // in the app-shell subscription.
  const getTaskItems = useTaskSuggestions({ workspaceId, editor });
  const getWorkspaceResourceItems = useResourceSuggestions({
    workspaceId,
    editor,
    // Selecting a diagram embeds a static snapshot (whole canvas or a chosen
    // frame) rather than an inline reference chip — open the frame picker to
    // choose what to capture.
    onDiagramSelect: setFramePickerTarget,
    // Selecting a spreadsheet opens the range dialog: blank inserts the chip
    // alone (the previous behaviour), a range adds a frozen table under it.
    onSpreadsheetSelect: setRangeTarget,
  });

  const getResourceItems = useMemo(() => {
    return async (query: string) => {
      const [taskItems, resourceItems] = await Promise.all([
        getTaskItems(query),
        getWorkspaceResourceItems(query),
      ]);
      return [...taskItems, ...resourceItems];
    };
  }, [getTaskItems, getWorkspaceResourceItems]);

  const sendMessage = () => {
    if (!canSend || !editor) return;
    const blocks: any[] = [...editor.document];
    if (imageUrls) {
      blocks.unshift({
        type: "image",
        props: {
          url: imageUrls.url,
          fullUrl: imageUrls.fullUrl,
          // Intrinsic thumbnail size: the renderer reserves the box from these
          // so the chat wall doesn't reflow as blobs stream in.
          width: imageUrls.width,
          height: imageUrls.height,
          ...(imageDiagram ? { diagramId: imageDiagram.id, diagramName: imageDiagram.name } : {}),
        },
      });
    }
    if (fileAttachment?.url) {
      blocks.unshift({
        type: "file",
        props: {
          url: fileAttachment.url,
          name: fileAttachment.name,
          mimeType: fileAttachment.mimeType,
          size: fileAttachment.size,
        },
      });
    }
    const body = JSON.stringify(blocks);
    let plainText = blocksToPlainText(editor.document, userNames, projectNames);
    // Give attachment-only messages searchable/quotable text: the diagram name
    // for a snapshot, the file name for a file.
    if (!plainText && imageDiagram) plainText = imageDiagram.name;
    if (!plainText && fileAttachment?.url) plainText = fileAttachment.name;

    handleSubmit(body, plainText);
    editorClear(editor);
    clearImage();
    clearFile();
  };

  const cancelEdit = () => {
    setEditingMessage({ id: null, body: null });
    if (editor) editorClear(editor);
    clearImage();
    clearFile();
  };

  useEffect(() => {
    if (!isEditing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Let an open BlockNote suggestion menu (`@`/`#`) consume Escape first.
      if (document.querySelector(".bn-suggestion-menu, .bn-grid-suggestion-menu")) return;
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  useEditorChange(() => {
    setIsEmpty(isEditorEmpty(editor));
  }, editor);

  // Autofocus on mount + channel navigation. Tiptap may not be initialized
  // by the time this effect first runs, so retry on rAF until it is.
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    const tryFocus = () => {
      if (cancelled) return;
      if (editor._tiptapEditor?.isInitialized) {
        editor.focus();
      } else {
        requestAnimationFrame(tryFocus);
      }
    };
    tryFocus();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  return (
    <div className="flex shrink-0 sm:flex-col flex-col-reverse p-4 pb-[calc(0.5rem+var(--safe-area-bottom))] max-w-full border-t gap-2">
      <div className="flex justify-between items-center">
        <FormattingToolbar
          editor={editor}
          canAttach={!!fileUpload}
          onAttachImage={(file) => void attachImageFile(file)}
          onAttachFile={(file) => void attachFile(file)}
        />
        {showCallButton && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void navigate("videocall")}
            title="Start a call"
            className="sm:w-18 sm:gap-1.5 sm:px-3"
          >
            <Phone className="h-4 w-4" />
            <span className="hidden sm:inline text-sm">Join</span>
          </Button>
        )}
      </div>
      {isEditing && <EditingBanner onCancel={cancelEdit} />}
      {replyingTo && (
        <MessageQuotePreview
          message={{
            author: replyingTo.author,
            plainText: replyPreviewText,
            deleted: false,
            imageUrl: replyingTo.imageUrl,
          }}
          onCancel={() => setReplyingTo(null)}
        />
      )}
      {isCapturingSnapshot && (
        <div className="flex w-fit items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <RippleSpinner size={16} />
          Capturing diagram…
        </div>
      )}
      {framePickerTarget && (
        <Suspense fallback={null}>
          <FramePickerDialog
            open
            diagramId={framePickerTarget.id}
            diagramName={framePickerTarget.name}
            onOpenChange={(open) => {
              if (!open) setFramePickerTarget(null);
            }}
            onInsert={(frameId) => {
              if (framePickerTarget) void captureDiagramSnapshot(framePickerTarget, frameId);
            }}
          />
        </Suspense>
      )}
      {rangeTarget && (
        <Suspense fallback={null}>
          <SpreadsheetRangeDialog
            spreadsheetId={rangeTarget.id}
            spreadsheetName={rangeTarget.name}
            onPick={({ cellRef, values }) =>
              insertSpreadsheetRange(rangeTarget, cellRef, values)
            }
            onClose={() => setRangeTarget(null)}
          />
        </Suspense>
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
      {fileAttachment && (
        <div className="relative flex w-fit max-w-xs items-center gap-2.5 rounded-md border bg-muted/50 py-2 pl-2.5 pr-7">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-background text-muted-foreground">
            {isUploadingFile ? <RippleSpinner size={16} /> : <Paperclip className="h-4 w-4" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{fileAttachment.name}</span>
            <span className="block text-xs text-muted-foreground">
              {isUploadingFile ? "Uploading\u2026" : formatFileSize(fileAttachment.size)}
            </span>
          </span>
          <button
            type="button"
            onClick={clearFile}
            aria-label="Remove attachment"
            className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className="flex gap-2 sm:mb-3" onPasteCapture={handlePaste}>
        {/* Decoration lives on this wrapper, not on BlockNoteView's `className`.
            BlockNoteView copies that prop onto BOTH the editor container and its
            floating-UI portal element — an empty, in-flow sibling div. Border
            classes there paint a stray hairline under the editor. (Only bites
            when `renderEditor` is left on; DocumentEditor passes false, which is
            why it never showed the artifact.) */}
        <div
          className={cn(
            // `message-composer-frame` scopes message-composer.css's BlockNote
            // padding override to this editor — see the comment on that rule.
            "message-composer-frame w-full grow min-w-0 box-border border rounded-md px-2 transition-shadow focus-within:ring-2 focus-within:ring-offset-1",
            isEditing
              ? "border-amber-500/50 focus-within:ring-amber-500"
              : "focus-within:ring-ring",
          )}
        >
          <BlockNoteView
            id="message-composer"
            editor={editor}
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
            <SuggestionMenuController triggerCharacter={"@"} getItems={getAtMentionItems} />
          </BlockNoteView>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button
            disabled={!canSend}
            onClick={sendMessage}
            size="icon"
            className={cn(
              "sm:w-18 sm:gap-1.5 sm:px-3 transition-transform active:scale-95",
              isEditing &&
                "bg-amber-600 hover:bg-amber-600/90 dark:bg-amber-500 dark:hover:bg-amber-500/90",
            )}
          >
            {isEditing ? <Check className="h-4 w-4" /> : <SendHorizonal className="h-4 w-4" />}
            <span className="hidden sm:inline text-sm">{isEditing ? "Save" : "Send"}</span>
          </Button>
          <div className="hidden sm:flex items-center gap-0.5">
            <Kbd>{isMac ? <Command /> : "Ctrl"}</Kbd>
            <Kbd>
              <CornerDownLeft />
            </Kbd>
          </div>
        </div>
      </div>
    </div>
  );
};
