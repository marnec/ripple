import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Hash, Trash2, Video } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { joinWindowStatus } from "../Dashboard/dashboard-calendar-utils";

const RSVP_LABEL: Record<"pending" | "accepted" | "tentative" | "declined", string> = {
  pending: "Pending",
  accepted: "Going",
  tentative: "Maybe",
  declined: "Declined",
};

const RSVP_BADGE_CLASS: Record<"pending" | "accepted" | "tentative" | "declined", string> = {
  pending: "bg-muted text-muted-foreground",
  accepted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  tentative: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  declined: "bg-destructive/15 text-destructive",
};

export function EventDetailSheet({
  eventId,
  open,
  onOpenChange,
  workspaceId,
}: {
  eventId: Id<"calendarEvents"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: Id<"workspaces">;
}) {
  const detail = useQuery(
    api.calendarEvents.get,
    eventId ? { eventId } : "skip",
  );
  const respond = useMutation(api.calendarEvents.respond);
  const cancel = useMutation(api.calendarEvents.cancel);
  const navigate = useNavigate();

  const viewer = useQuery(api.users.viewer);

  const myInvitee = useMemo(() => {
    if (!detail || !viewer) return undefined;
    return detail.invitees.find((i) => i.userId === viewer._id);
  }, [detail, viewer]);

  const isOrganizer = !!viewer && detail?.event.createdBy === viewer._id;
  // `now` ticks every 30s while the sheet is open so the Join button
  // appears/disappears across the join window without a manual refresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [open]);
  const callStatus =
    detail && detail.event.cancelledAt === undefined
      ? joinWindowStatus(detail.event.startsAt, detail.event.endsAt, now)
      : "ended";

  const handleRespond = async (status: "accepted" | "declined" | "tentative") => {
    if (!eventId) return;
    try {
      await respond({ eventId, status });
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

  const handleCancel = async () => {
    if (!eventId) return;
    if (!confirm("Cancel this event? Invitees will be notified.")) return;
    try {
      await cancel({ eventId });
      toast.success("Event cancelled");
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not cancel event", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const joinCall = () => {
    if (!eventId) return;
    void navigate(
      `/workspaces/${workspaceId}/calendar/events/${eventId}/videocall`,
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md flex flex-col gap-0 p-0">
        {!detail ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            {detail === null ? "Event not found" : null}
          </div>
        ) : (
          <>
            <SheetHeader className="p-4 pb-3 border-b">
              <div className="flex items-center gap-2 pr-8">
                <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                <SheetTitle className="text-base truncate">
                  {detail.event.title}
                </SheetTitle>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                <span>{formatRange(detail.event.startsAt, detail.event.endsAt)}</span>
                {detail.event.cancelledAt !== undefined && (
                  <span className="px-1.5 py-0.5 rounded font-medium bg-destructive/15 text-destructive">
                    Cancelled
                  </span>
                )}
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
              {/* Channel link */}
              {detail.channelName && detail.event.channelId && (
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm hover:underline self-start"
                  onClick={() => {
                    void navigate(
                      `/workspaces/${workspaceId}/channels/${detail.event.channelId}`,
                    );
                  }}
                >
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Linked to</span>
                  <span className="font-medium">{detail.channelName}</span>
                </button>
              )}

              {/* Description */}
              {detail.event.description && (
                <section>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                    Description
                  </p>
                  <p className="text-sm whitespace-pre-wrap">
                    {detail.event.description}
                  </p>
                </section>
              )}

              {/* Organizer */}
              <section>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                  Organizer
                </p>
                <PersonRow
                  name={detail.organizer.name ?? detail.organizer.email ?? "Unknown"}
                  image={detail.organizer.image}
                />
              </section>

              {/* Invitees */}
              <section>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Invitees
                  </p>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {detail.invitees.length}
                  </span>
                </div>
                {detail.invitees.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No one invited yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.invitees.map((inv) => (
                      <li
                        key={inv._id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <PersonRow
                          name={
                            inv.userName ??
                            inv.guestName ??
                            inv.guestEmail ??
                            "Invitee"
                          }
                          image={inv.userImage}
                          guest={!inv.userId}
                          subtitle={
                            inv.userId
                              ? inv.userEmail
                              : "Guest"
                          }
                        />
                        <span
                          className={cn(
                            "ml-auto text-[11px] px-1.5 py-0.5 rounded font-medium",
                            RSVP_BADGE_CLASS[inv.status],
                          )}
                        >
                          {RSVP_LABEL[inv.status]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* Footer actions */}
            <div className="border-t p-3 flex flex-col gap-2">
              {callStatus === "open" && detail.event.cancelledAt === undefined && (
                <Button onClick={joinCall} className="w-full">
                  <Video className="h-4 w-4 mr-1.5" />
                  Join call
                </Button>
              )}
              {callStatus === "pending" && (
                <p className="text-xs text-center text-muted-foreground">
                  Join opens 5 minutes before the event.
                </p>
              )}
              {!isOrganizer && myInvitee && detail.event.cancelledAt === undefined && (
                <div className="grid grid-cols-3 gap-1.5">
                  <Button
                    type="button"
                    variant={myInvitee.status === "accepted" ? "default" : "outline"}
                    size="sm"
                    onClick={() => void handleRespond("accepted")}
                  >
                    Going
                  </Button>
                  <Button
                    type="button"
                    variant={myInvitee.status === "tentative" ? "default" : "outline"}
                    size="sm"
                    onClick={() => void handleRespond("tentative")}
                  >
                    Maybe
                  </Button>
                  <Button
                    type="button"
                    variant={myInvitee.status === "declined" ? "default" : "outline"}
                    size="sm"
                    onClick={() => void handleRespond("declined")}
                  >
                    Decline
                  </Button>
                </div>
              )}
              {isOrganizer && detail.event.cancelledAt === undefined && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void handleCancel()}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Cancel event
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PersonRow({
  name,
  image,
  guest,
  subtitle,
}: {
  name: string;
  image?: string;
  guest?: boolean;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Avatar className="size-6">
        {image && <AvatarImage src={image} alt={name} />}
        <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex flex-col">
        <span className="text-sm truncate">
          {name}
          {guest && (
            <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              guest
            </span>
          )}
        </span>
        {subtitle && (
          <span className="text-xs text-muted-foreground truncate">{subtitle}</span>
        )}
      </div>
    </div>
  );
}

function formatRange(startsAt: number, endsAt: number): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const endFmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${fmt.format(new Date(startsAt))} – ${endFmt.format(new Date(endsAt))}`;
}
