import { cn } from "@/lib/utils";
import { useQuery } from "convex-helpers/react/cache";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CalendarDays } from "lucide-react";
import { useMentionedEvents } from "./MentionedUsersContext";

interface EventMentionChipProps {
  eventId: string; // comes from BlockNote inline content props
}

/**
 * Display-time chip for `@event` mentions.
 *
 * Server-enriched in chat (via `mentionedEvents` on the message payload) for
 * instant first paint; falls back to `api.calendarEvents.get` everywhere
 * else (docs, task descriptions, task comments). This mirrors how
 * `UserMentionRenderer` handles cached-vs-uncached.
 *
 * Deleted / cross-workspace events render as a muted, non-interactive
 * fallback so a stray reference can't leak metadata.
 */
export function EventMentionChip({ eventId }: EventMentionChipProps) {
  const mentionedEvents = useMentionedEvents();
  const cached = mentionedEvents[eventId];

  // Skip the live query if we already have the event in context (chat path).
  const eventResult = useQuery(
    api.calendarEvents.get,
    cached ? "skip" : { eventId: eventId as Id<"calendarEvents"> },
  );
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  // Cached path (chat messages, with server enrichment) ----------------------
  if (cached) {
    if (cached.deleted) return <DeletedFallback />;
    return (
      <InteractiveChip
        title={cached.title ?? "Event"}
        onClick={() => {
          if (!workspaceId) return;
          void navigate(`/workspaces/${workspaceId}/events/${eventId}`);
        }}
      />
    );
  }

  // Uncached path (docs, task descriptions/comments) -------------------------
  if (eventResult === undefined) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/10 align-middle">
        <span className="animate-pulse bg-muted h-3.5 w-3.5 rounded inline-block" />
        <span className="animate-pulse bg-muted h-3.5 w-20 rounded inline-block" />
      </span>
    );
  }

  if (eventResult === null) {
    return <DeletedFallback />;
  }

  const { event } = eventResult;
  return (
    <InteractiveChip
      title={event.title}
      onClick={() => {
        if (!workspaceId) return;
        void navigate(`/workspaces/${workspaceId}/events/${eventId}`);
      }}
    />
  );
}

function InteractiveChip({ title, onClick }: { title: string; onClick: () => void }) {
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
      <CalendarDays className="h-3 w-3 shrink-0" />
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
