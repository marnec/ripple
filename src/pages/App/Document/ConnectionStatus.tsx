import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CloudOff } from "lucide-react";

interface ConnectionStatusProps {
  isConnected: boolean;
}

/**
 * Two-state always-visible connection indicator.
 * - Connected: Small green dot
 * - Not Connected: Cloud-off icon (offline mode with IndexedDB)
 */
export function ConnectionStatus({ isConnected }: ConnectionStatusProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center">
            {isConnected ? (
              // Connected state: green dot
              <div className="w-2 h-2 rounded-full bg-green-500" />
            ) : (
              // Not connected state: cloud-off icon
              <CloudOff className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">
            {isConnected ? "Connected" : "Offline — changes saved locally"}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
