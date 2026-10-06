import { useRef } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@ripple/ui/components/button";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@shared/constants";
import { FileAttachmentCard, type FileAttachment } from "../Chat/FileAttachmentCard";
import type { CommentAttachmentsState } from "./useCommentAttachments";

/** Paperclip button that opens the file picker. */
export function AttachFilesButton({
  attachments,
  disabled,
  disabledReason,
}: {
  attachments: CommentAttachmentsState;
  disabled?: boolean;
  /** Shown as the tooltip while disabled. */
  disabledReason?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const off = disabled || !attachments.canUpload;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="pointer-coarse:size-9"
        disabled={off}
        onClick={() => inputRef.current?.click()}
        title={off && disabledReason ? disabledReason : "Attach files"}
        aria-label="Attach files"
      >
        <Paperclip className="h-4 w-4" />
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) attachments.add(e.target.files);
          // Reset so picking the same file again still fires `change`.
          e.target.value = "";
        }}
      />
    </>
  );
}

/** The attachments of a comment being written or edited, each removable. */
export function DraftAttachmentList({ attachments }: { attachments: CommentAttachmentsState }) {
  if (attachments.items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {attachments.items.map((item) => (
        <div
          key={item.key}
          className="flex max-w-56 items-center gap-1.5 rounded-md border bg-background/60 py-1 pr-1 pl-2 text-xs"
        >
          {item.url === null && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
          <span className={cn("min-w-0 truncate", item.url === null && "text-muted-foreground")}>
            {item.name}
          </span>
          {item.size ? (
            <span className="shrink-0 text-muted-foreground">{formatFileSize(item.size)}</span>
          ) : null}
          <button
            type="button"
            onClick={() => attachments.remove(item.key)}
            aria-label={`Remove ${item.name}`}
            className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground pointer-coarse:p-1.5"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** A posted comment's attachments, as download cards. */
export function CommentAttachmentList({ attachments }: { attachments: readonly FileAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <FileAttachmentCard key={attachment.url} attachment={attachment} className="max-w-full" />
      ))}
    </div>
  );
}
