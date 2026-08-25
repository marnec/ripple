import { Video } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ripple/ui/components/tooltip";
import { cn } from "@/lib/utils";
import type { ChannelCallParticipant } from "@/hooks/use-channel-calls";

export interface ChannelCallIndicatorProps {
  participants: ChannelCallParticipant[];
  className?: string;
}

/**
 * "A call is happening here" marker for a sidebar channel row.
 *
 * Deliberately not a join button. The row's dropdown already carries "Join
 * call", and a second interactive element would have to be a positioned
 * sibling of the row button (the row itself is a `div role="button"`, so
 * nesting one is invalid) — competing for the same corner the hover menu
 * already occupies. The indicator is the signal; the menu is the action.
 *
 * Names go in the tooltip rather than on the row: who is in the call is the
 * "more information on demand" half, and avatars do not fit a collapsed
 * sidebar.
 */
export function ChannelCallIndicator({
  participants,
  className,
}: ChannelCallIndicatorProps) {
  if (participants.length === 0) return null;

  const names = participants.map((p) => p.userName).join(", ");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "relative flex shrink-0 items-center gap-0.5 text-primary",
              className,
            )}
            // The row is already a button; this is decoration on top of it.
            aria-label={`Call in progress — ${participants.length} ${
              participants.length === 1 ? "participant" : "participants"
            }`}
          />
        }
      >
        <span className="relative flex size-3.5 items-center justify-center">
          <span
            className="absolute inline-flex size-full animate-ping rounded-full bg-primary/40 motion-reduce:hidden"
            aria-hidden
          />
          <Video className="relative size-3.5" />
        </span>
        {participants.length > 1 && (
          <span className="text-[10px] font-medium tabular-nums">
            {participants.length}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>
        {participants.length === 1 ? `${names} is in a call` : `In this call: ${names}`}
      </TooltipContent>
    </Tooltip>
  );
}
