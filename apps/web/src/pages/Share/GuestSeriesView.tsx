import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { CalendarDays, Repeat } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@ripple/ui/components/button";
import { RippleSpinner } from "@/components/RippleSpinner";
import { api } from "@convex/_generated/api";
import { expandSeries, type Weekday } from "@ripple/shared/recurrence";
import { useJoinStatusTick } from "../App/Calendar/useJoinStatusTick";

interface Props {
  shareId: string;
  guestName: string;
}

/** How far ahead the landing page looks for occurrences to preview. */
const PREVIEW_WINDOW_MS = 400 * 24 * 60 * 60 * 1000;
const PREVIEW_COUNT = 3;

/**
 * Guest landing surface for a **series** share.
 *
 * The one difference from `GuestEventView` that matters: the guest is being
 * asked about a repeating commitment, not a date, so the answer is one RSVP
 * for the whole thing and the page shows the pattern rather than a single
 * time. The server hands back the rule and this expands it — the recurrence
 * module is shared and imports nothing but Temporal, so the dates are computed
 * the same way on both sides rather than being serialized into a list.
 *
 * No call control here: joining an occurrence's call from a guest link is its
 * own piece of work.
 */
export function GuestSeriesView({ shareId, guestName }: Props) {
  const data = useQuery(api.eventSeries.getByShareId, { shareId });
  const respond = useMutation(api.eventSeries.respondAsGuest);
  // Hooks run unconditionally; the early returns are below. The tick keeps the
  // "next few" list from going stale on a tab left open past an occurrence.
  const now = useJoinStatusTick();

  if (data === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <RippleSpinner size={48} />
      </div>
    );
  }
  if (data.status !== "active" || !data.series) {
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

  const series = data.series;
  const upcoming = expandSeries(
    {
      anchor: {
        date: series.anchorDate,
        time: series.anchorTime,
        timezone: series.timezone,
        durationMs: series.durationMs,
      },
      rule: {
        freq: series.rule.freq,
        interval: series.rule.interval,
        weekdays: series.rule.weekdays as Weekday[] | undefined,
        monthlyMode: series.rule.monthlyMode,
        end: series.rule.end,
      },
      excludedStarts: series.excludedStarts,
    },
    { windowStartMs: now, windowEndMs: now + PREVIEW_WINDOW_MS },
  ).slice(0, PREVIEW_COUNT);

  const handleRespond = async (
    status: "accepted" | "tentative" | "declined",
  ) => {
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
          Recurring invitation
        </div>
        <h1 className="mt-2 text-xl font-semibold">{series.title}</h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Repeat className="h-3.5 w-3.5" />
          {describeRule(series.rule)}
        </p>
        {series.organizerName && (
          <p className="mt-2 text-sm">
            Organized by{" "}
            <span className="font-medium">{series.organizerName}</span>
            {series.workspaceName && (
              <span className="text-muted-foreground">
                {" "}
                · {series.workspaceName}
              </span>
            )}
          </p>
        )}
        {series.description && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
            {series.description}
          </p>
        )}

        {upcoming.length > 0 && (
          <ul className="mt-4 space-y-1 border-t pt-4 text-sm text-muted-foreground">
            {upcoming.map((o) => (
              <li key={o.originalStartMs}>
                {formatRange(o.startsAt, o.endsAt, series.timezone)}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          Answering once covers every occurrence.
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
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
      </div>
    </div>
  );
}

function describeRule(rule: { freq: string; interval: number }): string {
  const unit =
    rule.freq === "daily"
      ? "day"
      : rule.freq === "weekly"
        ? "week"
        : rule.freq === "monthly"
          ? "month"
          : "year";
  return rule.interval === 1
    ? `Every ${unit}`
    : `Every ${rule.interval} ${unit}s`;
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
