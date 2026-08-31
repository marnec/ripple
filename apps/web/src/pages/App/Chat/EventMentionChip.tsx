import { cn } from "@/lib/utils";
import { useQuery } from "convex-helpers/react/cache";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CalendarDays, Repeat } from "lucide-react";
import { eventMentionHref, eventMentionTarget } from "@/lib/event-mention";
import { useMentionedEvents } from "./MentionedUsersContext";

interface EventMentionChipProps {
  eventId?: string; // comes from BlockNote inline content props
  seriesId?: string;
}

/**
 * Display-time chip for `@event` mentions.
 *
 * Server-enriched in chat (via `mentionedEvents` on the message payload) for
 * instant first paint; falls back to `api.calendarEvents.get` everywhere
 * else (docs, task descriptions, task comments). This mirrors how
 * `UserMentionRenderer` handles cached-vs-uncached.
 *
 * A mention of a **series** takes the query path always: the message
 * enrichment resolves ids in the events table, and a series is not one. The
 * cost is one cheap workspace-scoped read per repeating mention, which is what
 * the docs path already pays for every event mention.
 *
 * Deleted / cross-workspace events render as a muted, non-interactive
 * fallback so a stray reference can't leak metadata.
 */
export function EventMentionChip({ eventId, seriesId }: EventMentionChipProps) {
  const target = eventMentionTarget({ eventId, seriesId });
  if (target.kind === "series") {
    return <SeriesChip seriesId={target.seriesId} />;
  }
  if (target.kind === "unknown") return <DeletedFallback />;
  return <EventChip eventId={target.eventId} />;
}

function SeriesChip({ seriesId }: { seriesId: Id<"eventSeries"> }) {
  const series = useQuery(api.eventSeries.get, { seriesId });
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  if (series === undefined) return <LoadingChip />;
  if (series === null) return <DeletedFallback />;

  return (
    <InteractiveChip
      title={series.title}
      repeating
      onClick={() => {
        if (!workspaceId) return;
        const href = eventMentionHref(workspaceId as Id<"workspaces">, {
          kind: "series",
          seriesId,
        });
        if (href) void navigate(href);
      }}
    />
  );
}

function EventChip({ eventId }: { eventId: Id<"calendarEvents"> }) {
  const mentionedEvents = useMentionedEvents();
  const cached = mentionedEvents[eventId];

  // Skip the live query if we already have the event in context (chat path).
  const eventResult = useQuery(api.calendarEvents.get, cached ? "skip" : { eventId });
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  const open = () => {
    if (!workspaceId) return;
    const href = eventMentionHref(workspaceId as Id<"workspaces">, {
      kind: "event",
      eventId,
    });
    if (href) void navigate(href);
  };

  // Cached path (chat messages, with server enrichment) ----------------------
  if (cached) {
    if (cached.deleted) return <DeletedFallback />;
    return <InteractiveChip title={cached.title ?? "Event"} onClick={open} />;
  }

  // Uncached path (docs, task descriptions/comments) -------------------------
  if (eventResult === undefined) return <LoadingChip />;
  if (eventResult === null) return <DeletedFallback />;

  return <InteractiveChip title={eventResult.event.title} onClick={open} />;
}

function LoadingChip() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/10 align-middle">
      <span className="animate-pulse bg-muted h-3.5 w-3.5 rounded inline-block" />
      <span className="animate-pulse bg-muted h-3.5 w-20 rounded inline-block" />
    </span>
  );
}

function InteractiveChip({
  title,
  onClick,
  repeating = false,
}: {
  title: string;
  onClick: () => void;
  repeating?: boolean;
}) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  };
  return (
    <button
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full align-middle text-sm font-medium",
        "bg-purple-500/10 dark:bg-purple-400/10 text-purple-700 dark:text-purple-300",
        "hover:bg-purple-500/20 dark:hover:bg-purple-400/20 transition-colors cursor-pointer",
      )}
    >
      {repeating ? (
        <Repeat className="h-3 w-3 shrink-0" />
      ) : (
        <CalendarDays className="h-3 w-3 shrink-0" />
      )}
      <span className="max-w-50 truncate">{title}</span>
    </button>
  );
}

function DeletedFallback() {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-sm align-middle line-through"
      title="This event is no longer available"
    >
      <CalendarDays className="h-3 w-3 shrink-0" />
      deleted event
    </span>
  );
}
