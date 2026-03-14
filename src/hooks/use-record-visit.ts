import { useEffect, useRef } from "react";
import { recordLocalVisit, type ResourceType } from "./use-local-recents";

export function useRecordVisit(
  workspaceId: string | undefined,
  resourceType: ResourceType,
  resourceId: string | undefined,
  resourceName: string | undefined,
) {
  const lastRecorded = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceId || !resourceId || !resourceName) return;
    if (lastRecorded.current === resourceId) return;
    lastRecorded.current = resourceId;
    recordLocalVisit(workspaceId, resourceType, resourceId, resourceName);
  }, [workspaceId, resourceType, resourceId, resourceName]);
}
