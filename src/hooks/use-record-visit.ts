import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type ResourceType = "channel" | "document" | "diagram" | "spreadsheet" | "project";

export function useRecordVisit(
  workspaceId: Id<"workspaces"> | undefined,
  resourceType: ResourceType,
  resourceId: string | undefined,
  resourceName: string | undefined,
) {
  const recordVisit = useMutation(api.recentActivity.recordVisit);
  const lastRecorded = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceId || !resourceId || !resourceName) return;
    if (lastRecorded.current === resourceId) return;
    lastRecorded.current = resourceId;
    void recordVisit({ workspaceId, resourceType, resourceId, resourceName });
  }, [workspaceId, resourceType, resourceId, resourceName, recordVisit]);
}
