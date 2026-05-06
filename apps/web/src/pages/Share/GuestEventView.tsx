import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { CalendarDays, Video } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { RippleSpinner } from "@/components/RippleSpinner";
import { joinWindowStatus } from "../App/Dashboard/dashboard-calendar-utils";
import { api } from "@convex/_generated/api";

import { GuestEventCall } from "./GuestEventCall";

interface Props {
  shareId: string;
  guestSub: string;
  guestName: string;
}

/**
 * Guest landing surface for a calendar event share.
 *
 * Two phases:
 *   1. Pre-call: show event details + RSVP buttons.
 *   2. In-call: render the embedded RealtimeKit room, joined via the
 *      calendar-event guest action (`getGuestEventCallToken`).
 *
 * The guest's name + sub were captured at /share/:shareId by ShareEntryPage,
 * so this component never asks for them again.
 */
export function GuestEventView({ shareId, guestSub, guestName }: Props) {
  const data = useQuery(api.calendarEvents.getByShareId, { shareId });
  const respond = useMutation(api.calendarEvents.respondAsGuest);
  const [inCall, setInCall] = useState(false);

  // Tick `now` every 30 s so the Join button appears at start − 5 min
  // without a manual refresh. Hooks must run unconditionally; the early
  // returns happen below.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (data === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <RippleSpinner size={48} />
      </div>
    );
  }
  if (data.status !== "active" || !data.event) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-xl font-semibold">Invitation no longer available</h1>
          <p className="text-sm text-muted-foreground">
            {data.status === "expired"
              ? "This invitation has expired."
              : data.status === "revoked"
                ? "The organizer cancelled or revoked this invitation."
                : "This invitation does not exist."}
          </p>
        </div>
      </div>
    );
  }

  const callStatus = joinWindowStatus(
    data.event.startsAt,
    data.event.endsAt,
    now,
  );

  if (inCall) {
    return (
      <GuestEventCall
        shareId={shareId}
        guestSub={guestSub}
        guestName={guestName}
        onLeave={() => setInCall(false)}
      />
    );
  }

  const handleRespond = async (status: "accepted" | "tentative" | "declined") => {
    try {
      await respond({ shareId, status, guestName });
      toast.success(
        status === "accepted"
          ? "Marked as going"
          : status === "tentative"
            ? "Marked as maybe"
            : "Declined",
      );
    } catch (e) {
      toast.error("Could not save response", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const myStatus = data.invitee?.status ?? "pending";

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-8">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
          <CalendarDays className="h-3.5 w-3.5" />
          Event invitation
        </div>
        <h1 className="mt-2 text-xl font-semibold">{data.event.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatRange(
            data.event.startsAt,
            data.event.endsAt,
            data.event.timezone,
          )}
        </p>
        {data.event.organizerName && (
          <p className="mt-2 text-sm">
            Organized by{" "}
            <span className="font-medium">{data.event.organizerName}</span>
            {data.event.workspaceName && (
              <span className="text-muted-foreground"> · {data.event.workspaceName}</span>
            )}
          </p>
        )}
        {data.event.description && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
            {data.event.description}
          </p>
        )}

        <div className="mt-5 grid grid-cols-3 gap-2">
          <Button
            type="button"
            variant={myStatus === "accepted" ? "default" : "outline"}
            size="sm"
            onClick={() => void handleRespond("accepted")}
          >
            Going
          </Button>
          <Button
            type="button"
            variant={myStatus === "tentative" ? "default" : "outline"}
            size="sm"
            onClick={() => void handleRespond("tentative")}
          >
            Maybe
          </Button>
          <Button
            type="button"
            variant={myStatus === "declined" ? "default" : "outline"}
            size="sm"
            onClick={() => void handleRespond("declined")}
          >
            Decline
          </Button>
        </div>

        <div className="mt-5 border-t pt-4">
          {callStatus === "open" ? (
            <Button className="w-full" onClick={() => setInCall(true)}>
              <Video className="h-4 w-4 mr-1.5" />
              Join call
            </Button>
          ) : callStatus === "pending" ? (
            <p className="text-xs text-center text-muted-foreground">
              The call opens 5 minutes before the start time.
            </p>
          ) : (
            <p className="text-xs text-center text-muted-foreground">
              This call has ended.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRange(startsAt: number, endsAt: number, timezone: string): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const endFmt = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${fmt.format(new Date(startsAt))} – ${endFmt.format(new Date(endsAt))}`;
}

