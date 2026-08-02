import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CloudOff, TriangleAlert } from "lucide-react";

interface ConnectionStatusProps {
  isConnected: boolean;
  /**
   * The sync layer is erroring even though the socket may be up: edits still
   * apply locally but are not reliably shared. Takes precedence over
   * `isConnected` — a live socket carrying nothing is the more misleading of
   * the two states.
   */
  hasSyncError?: boolean;
}

/**
 * Always-visible sync indicator.
 * - Connected: Small green dot
 * - Not Connected: Cloud-off icon (offline mode with IndexedDB)
 * - Sync error: Amber warning (editing works, sharing doesn't)
 */
export function ConnectionStatus({ isConnected, hasSyncError }: ConnectionStatusProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={<div className="flex items-center" />}>
            {hasSyncError ? (
              // Sync error state: amber warning triangle
              <TriangleAlert className="h-4 w-4 text-amber-500" />
            ) : isConnected ? (
              // Connected state: green dot
              <div className="w-2 h-2 rounded-full bg-green-500" />
            ) : (
              // Not connected state: cloud-off icon
              <CloudOff className="h-4 w-4 text-muted-foreground" />
            )}
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">
            {hasSyncError
              ? "Live sync hit an error — keep editing, but reload to share changes"
              : isConnected
                ? "Connected"
                : "Offline — changes saved locally"}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
