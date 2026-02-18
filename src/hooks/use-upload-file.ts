import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

/**
 * Returns an `uploadFile` function compatible with BlockNote's `uploadFile` editor option.
 * Uploads files to Convex storage and records metadata in the `medias` table.
 */
export function useUploadFile(workspaceId: Id<"workspaces"> | undefined) {
  const generateUploadUrl = useMutation(api.medias.generateUploadUrl);
  const saveMedia = useMutation(api.medias.saveMedia);

  // Keep workspaceId in a ref so the callback identity is stable
  const workspaceIdRef = useRef(workspaceId);
  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);

  const uploadFile = useCallback(
    async (file: File): Promise<string> => {
      const wsId = workspaceIdRef.current;
      if (!wsId) throw new Error("Workspace not available for upload");

      // 1. Get a short-lived upload URL from Convex
      const uploadUrl = await generateUploadUrl();

      // 2. POST the file to the upload URL
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

      // 3. Save metadata and get the serving URL
      const url = await saveMedia({
        storageId,
        workspaceId: wsId,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        type: "image",
      });

      return url;
    },
    [generateUploadUrl, saveMedia]
  );

  return workspaceId ? uploadFile : undefined;
}
