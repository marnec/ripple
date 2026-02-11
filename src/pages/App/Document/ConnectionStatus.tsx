import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type YPartyKitProvider from "y-partykit/provider";

interface ConnectionStatusProps {
  isConnected: boolean;
  provider: YPartyKitProvider | null;
}

export function ConnectionStatus({ isConnected, provider }: ConnectionStatusProps) {
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (!provider) return;

    // Track initial sync status
    const handleSync = (synced: boolean) => {
      if (synced) {
        setIsSyncing(false);
      }
    };

    // Track connection status changes
    const handleStatus = ({ status }: { status: string }) => {
      if (status === "connecting") {
        setIsSyncing(true);
      } else if (status === "connected") {
        // Show syncing briefly after reconnection
        setIsSyncing(true);
        setTimeout(() => setIsSyncing(false), 500);
      }
    };

    provider.on("sync", handleSync);
    provider.on("status", handleStatus);

    return () => {
      provider.off("sync", handleSync);
      provider.off("status", handleStatus);
    };
  }, [provider]);

  // Listen to yDoc updates to show syncing state
  useEffect(() => {
    if (!provider) return;

    const yDoc = provider.doc;

    const handleUpdate = () => {
      // Show syncing indicator briefly when local changes occur
      setIsSyncing(true);
      const timer = setTimeout(() => setIsSyncing(false), 500);
      return () => clearTimeout(timer);
    };

    yDoc.on("update", handleUpdate);

    return () => {
      yDoc.off("update", handleUpdate);
    };
  }, [provider]);

  // Determine state: disconnected, syncing, or connected
  const getStatus = () => {
    if (!isConnected) return "disconnected";
    if (isSyncing) return "syncing";
    return "connected";
  };

  const status = getStatus();

  const statusConfig = {
    connected: {
      color: "bg-green-500",
      tooltip: "Connected",
      showIcon: false,
    },
    syncing: {
      color: "bg-yellow-500",
      tooltip: "Syncing changes...",
      showIcon: true,
    },
    disconnected: {
      color: "bg-red-500",
      tooltip: "Offline — changes saved locally",
      showIcon: false,
    },
  };

  const config = statusConfig[status];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5">
            {config.showIcon && (
              <Loader2 className="h-3 w-3 text-yellow-600 animate-spin" />
            )}
            <div
              className={cn(
                "w-2 h-2 rounded-full",
                config.color,
                status === "syncing" && "animate-pulse"
              )}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{config.tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
