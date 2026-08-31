import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export interface ImageUploadResult {
  /** Thumbnail URL (or original if already small) */
  url: string;
  /** Full-resolution URL */
  fullUrl: string;
  /** Intrinsic size of the thumbnail — lets the chat reserve layout space
   * before the blob loads (see MessageRenderer). */
  width: number;
  height: number;
}

export interface FileUploadResult {
  /** Hosted URL of the stored blob. */
  url: string;
  /** Original file name, as picked — what the attachment card shows. */
  name: string;
  mimeType: string;
  size: number;
}

/**
 * Returns an `uploadFile` function compatible with BlockNote's `uploadFile` editor option,
 * plus an `uploadImageWithThumbnail` for chat image uploads.
 */
export function useUploadFile(workspaceId: Id<"workspaces"> | undefined) {
  const generateUploadUrl = useMutation(api.medias.generateUploadUrl);
  const saveMedia = useMutation(api.medias.saveMedia);

  // Keep workspaceId in a ref so the callback identity is stable
  const workspaceIdRef = useRef(workspaceId);
  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);

  const uploadStoredFile = async (file: File, type: "image" | "file"): Promise<string> => {
    const wsId = workspaceIdRef.current;
    if (!wsId) throw new Error("Workspace not available for upload");

    const uploadUrl = await generateUploadUrl();

    const result = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });

    if (!result.ok) {
      throw new Error(`Upload failed: ${result.statusText}`);
    }

    const { storageId } = (await result.json()) as {
      storageId: Id<"_storage">;
    };

    const url = await saveMedia({
      storageId,
      workspaceId: wsId,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      type,
    });

    return url;
  };

  /**
   * BlockNote's `uploadFile` option. Its own signature is
   * `(file, blockId?) => Promise<string>`, so this wrapper takes exactly one
   * argument — widening it with a second parameter would let BlockNote's
   * `blockId` land in it.
   */
  const uploadSingleFile = (file: File): Promise<string> => uploadStoredFile(file, "image");

  /**
   * A non-image chat attachment: one blob, stored as-is. There is no
   * thumbnail leg — nothing to derive one from — so the message body carries
   * the single URL plus the name/type/size the card renders.
   */
  const uploadAttachment = async (file: File): Promise<FileUploadResult> => {
    const url = await uploadStoredFile(file, "file");
    return {
      url,
      // A file with no name at all (some clipboard payloads) still needs a
      // label; the card would otherwise render an empty row.
      name: file.name || "attachment",
      mimeType: file.type,
      size: file.size,
    };
  };

  const uploadImageWithThumbnail = async (
    original: File,
    thumbnail: File,
    isOriginal: boolean,
    size: { width: number; height: number },
  ): Promise<ImageUploadResult> => {
    if (isOriginal) {
      const url = await uploadSingleFile(original);
      return { url, fullUrl: url, ...size };
    }

    const [thumbnailUrl, fullUrl] = await Promise.all([
      uploadSingleFile(thumbnail),
      uploadSingleFile(original),
    ]);

    return { url: thumbnailUrl, fullUrl, ...size };
  };

  return workspaceId
    ? { uploadFile: uploadSingleFile, uploadImageWithThumbnail, uploadAttachment }
    : undefined;
}
