import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@ripple/ui/components/tooltip";
import { CloudOff, TriangleAlert } from "lucide-react";

interface ConnectionStatusProps {
  isConnected: boolean;
  /**
   * Still trying to reach the room. Distinct from offline, which is a verdict:
   * showing the offline icon while an attempt is in flight tells the user the
   * document is stranded when it may be about to connect.
   */
  isConnecting?: boolean;
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
 * - Connected: small green dot
 * - Connecting: amber dot — an attempt is still in flight
 * - Offline: cloud-off icon (editing continues against the local copy)
 * - Sync error: amber warning (editing works, sharing doesn't)
 */
export function ConnectionStatus({
  isConnected,
  isConnecting,
  hasSyncError,
}: ConnectionStatusProps) {
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
          ) : isConnecting ? (
            // Still trying: a ping expanding out of a steady dot, no verdict
            // yet. The ring is absolutely positioned so that scaling it does
            // not change the indicator's footprint — this state has to occupy
            // exactly the same 2x2 as the connected dot, or the toolbar shifts
            // as the connection settles. The solid core is what carries the
            // meaning, so the animation is dropped under reduced motion rather
            // than replaced.
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full animate-ping rounded-full bg-amber-400 opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-amber-500" />
            </span>
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
                : isConnecting
                  ? "Connecting…"
                  : "Offline — changes saved locally"}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
