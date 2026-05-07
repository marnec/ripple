import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Doc } from "@convex/_generated/dataModel";

type RsvpStatus = Doc<"calendarEventInvitees">["status"];

/**
 * Three-button RSVP row (Going / Maybe / Decline). Used by the event
 * detail sheet (3-column grid) and the page (max-w-md horizontal flex)
 * — caller controls the layout via `className`, button-cell behaviour
 * via `buttonClassName`.
 *
 * Renders nothing for the organizer (they don't RSVP to their own
 * event) or once the event is cancelled.
 */
export function RsvpResponseGroup({
  myStatus,
  onRespond,
  className,
  buttonClassName,
}: {
  myStatus: RsvpStatus | null;
  onRespond: (status: "accepted" | "tentative" | "declined") => void;
  className?: string;
  buttonClassName?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Button
        type="button"
        variant={myStatus === "accepted" ? "default" : "outline"}
        size="sm"
        className={buttonClassName}
        onClick={() => onRespond("accepted")}
      >
        Going
      </Button>
      <Button
        type="button"
        variant={myStatus === "tentative" ? "default" : "outline"}
        size="sm"
        className={buttonClassName}
        onClick={() => onRespond("tentative")}
      >
        Maybe
      </Button>
      <Button
        type="button"
        variant={myStatus === "declined" ? "default" : "outline"}
        size="sm"
        className={buttonClassName}
        onClick={() => onRespond("declined")}
      >
        Decline
      </Button>
    </div>
  );
}
