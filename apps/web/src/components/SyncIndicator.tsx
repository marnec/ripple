import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@ripple/ui/components/tooltip";
import type { SyncState } from "@/lib/collab/connection-policy";
import { CloudOff, TriangleAlert } from "lucide-react";

/**
 * Always-visible sync indicator.
 * - Connected: small green dot
 * - Connecting: amber ping — an attempt is still in flight
 * - Offline: cloud-off icon (editing continues against the local copy)
 * - Error: amber warning (editing works, sharing doesn't)
 *
 * The interface is the single `SyncState` the connection policy computes, not
 * a set of booleans: which states exist is this module's business, and a
 * caller cannot under-supply one value the way it could omit `isConnecting`.
 */
export function SyncIndicator({ state }: { state: SyncState }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={<div className="flex items-center" />}>
          {state === "error" ? (
            <TriangleAlert className="h-4 w-4 text-amber-500" />
          ) : state === "connected" ? (
            <div className="w-2 h-2 rounded-full bg-green-500" />
          ) : state === "connecting" ? (
            // A ping expanding out of a steady dot, no verdict yet. The ring is
            // absolutely positioned so that scaling it does not change the
            // indicator's footprint — this state has to occupy exactly the same
            // 2x2 as the connected dot, or the toolbar shifts as the connection
            // settles. The solid core is what carries the meaning, so the
            // animation is dropped under reduced motion rather than replaced.
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full animate-ping rounded-full bg-amber-400 opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-amber-500" />
            </span>
          ) : (
            <CloudOff className="h-4 w-4 text-muted-foreground" />
          )}
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{TOOLTIP[state]}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const TOOLTIP: Record<SyncState, string> = {
  error: "Live sync hit an error — keep editing, but reload to share changes",
  connected: "Connected",
  connecting: "Connecting…",
  offline: "Offline — changes saved locally",
};
