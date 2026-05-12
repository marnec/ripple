import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { CalendarDays } from "lucide-react";

/**
 * Editor-time inline content spec for `@event` mentions.
 *
 * Renders a compact pill while composing. The display-time chip used by
 * `BlockNoteRenderer` (in chat messages, task comments, etc.) is
 * `EventMentionChip`, which reads from `MentionedEventsContext` when
 * server-side enrichment is available and falls back to its own query
 * otherwise — mirroring `UserMentionRenderer`.
 */
export const EventMention = createReactInlineContentSpec(
  {
    type: "eventMention",
    propSchema: {
      eventId: { default: "" },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { eventId } = inlineContent.props;
      if (!eventId) {
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-destructive/20 text-sm align-middle">
            @unknown-event
          </span>
        );
      }
      return <EventMentionEditorPill eventId={eventId as Id<"calendarEvents">} />;
    },
  },
);

function EventMentionEditorPill({ eventId }: { eventId: Id<"calendarEvents"> }) {
  // Cheap live lookup in the composer — event is workspace-readable so any
  // member can resolve the title for the chip preview.
  const event = useQuery(api.calendarEvents.get, { eventId });
  const title = event?.event.title ?? "Event";
  return (
    <span
      data-event-id={eventId}
      data-content-type="event-mention"
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full",
        "bg-purple-500/10 dark:bg-purple-400/10 text-purple-700 dark:text-purple-300",
        "text-sm font-medium cursor-default align-middle",
      )}
      contentEditable={false}
    >
      <CalendarDays className="h-3 w-3 shrink-0" />
      <span className="max-w-50 truncate">{title}</span>
    </span>
  );
}
