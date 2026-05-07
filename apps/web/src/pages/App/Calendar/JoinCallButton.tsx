import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JoinWindowStatus } from "../Dashboard/dashboard-calendar-utils";
import { cn } from "@/lib/utils";

/**
 * Renders the Join-call affordance for an event detail surface (sheet,
 * page, or guest landing). Shows the Join button while the call window
 * is open; renders a "Join opens 5 minutes before the event" hint
 * during the pending phase; renders nothing once the window closes or
 * the event is cancelled.
 *
 * The button styling differs subtly between surfaces (`w-full` in the
 * sheet footer, `self-start min-w-40` on the page) so callers pass a
 * `className`.
 */
export function JoinCallButton({
  status,
  cancelled,
  onJoin,
  className,
  pendingClassName,
}: {
  status: JoinWindowStatus;
  cancelled: boolean;
  onJoin: () => void;
  className?: string;
  pendingClassName?: string;
}) {
  if (cancelled) return null;
  if (status === "open") {
    return (
      <Button onClick={onJoin} className={className}>
        <Video className="h-4 w-4 mr-1.5" />
        Join call
      </Button>
    );
  }
  if (status === "pending") {
    return (
      <p
        className={cn(
          "text-xs text-muted-foreground",
          pendingClassName,
        )}
      >
        Join opens 5 minutes before the event.
      </p>
    );
  }
  return null;
}
