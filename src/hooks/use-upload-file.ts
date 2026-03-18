import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

export interface ImageUploadResult {
  /** Thumbnail URL (or original if already small) */
  url: string;
  /** Full-resolution URL */
  fullUrl: string;
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

  const uploadSingleFile = async (file: File): Promise<string> => {
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
      type: "image",
    });

    return url;
  };

  const uploadImageWithThumbnail = async (original: File, thumbnail: File, isOriginal: boolean): Promise<ImageUploadResult> => {
    if (isOriginal) {
      const url = await uploadSingleFile(original);
      return { url, fullUrl: url };
    }

    const [thumbnailUrl, fullUrl] = await Promise.all([
      uploadSingleFile(thumbnail),
      uploadSingleFile(original),
    ]);

    return { url: thumbnailUrl, fullUrl };
  };

  return workspaceId
    ? { uploadFile: uploadSingleFile, uploadImageWithThumbnail }
    : undefined;
}
