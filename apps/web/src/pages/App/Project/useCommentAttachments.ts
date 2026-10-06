import { useState } from "react";
import { toast } from "sonner";
import { useUploadFile } from "@/hooks/use-upload-file";
import { MESSAGE_FILE_ATTACHMENT_MAX_BYTES, formatFileSize } from "@shared/constants";
import type { Id } from "@convex/_generated/dataModel";
import type { FileAttachment } from "../Chat/FileAttachmentCard";

/** An attachment in a comment being written: `url` is null while it uploads. */
type DraftAttachment = Omit<FileAttachment, "url"> & { key: string; url: string | null };

/**
 * The attachments of one comment being written or edited. Uploads start on
 * pick; the comment can be sent once none is in flight. Removing one mid-upload
 * drops its result when it lands instead of resurrecting it.
 */
export function useCommentAttachments(
  workspaceId: Id<"workspaces">,
  initial: readonly FileAttachment[] = [],
) {
  const fileUpload = useUploadFile(workspaceId);
  const [items, setItems] = useState<DraftAttachment[]>(() =>
    initial.map((a) => ({ ...a, key: a.url })),
  );

  const add = (files: Iterable<File>) => {
    if (!fileUpload) return;
    for (const file of files) {
      if (file.size > MESSAGE_FILE_ATTACHMENT_MAX_BYTES) {
        toast.error(
          `${file.name || "That file"} is too large (max ${formatFileSize(MESSAGE_FILE_ATTACHMENT_MAX_BYTES)}).`,
        );
        continue;
      }
      const key = crypto.randomUUID();
      setItems((prev) => [
        ...prev,
        { key, url: null, name: file.name || "attachment", mimeType: file.type, size: file.size },
      ]);
      fileUpload.uploadAttachment(file).then(
        (uploaded) =>
          setItems((prev) => prev.map((item) => (item.key === key ? { ...uploaded, key } : item))),
        (error: unknown) => {
          console.error("Comment attachment upload failed:", error);
          toast.error(`Couldn't upload ${file.name || "that file"}.`);
          setItems((prev) => prev.filter((item) => item.key !== key));
        },
      );
    }
  };

  const remove = (key: string) => setItems((prev) => prev.filter((item) => item.key !== key));
  const clear = () => setItems([]);

  const uploaded: FileAttachment[] = items.flatMap((item) =>
    item.url ? [{ url: item.url, name: item.name, mimeType: item.mimeType, size: item.size }] : [],
  );

  return {
    items,
    uploaded,
    isUploading: items.some((item) => item.url === null),
    canUpload: fileUpload !== undefined,
    add,
    remove,
    clear,
  };
}

export type CommentAttachmentsState = ReturnType<typeof useCommentAttachments>;
