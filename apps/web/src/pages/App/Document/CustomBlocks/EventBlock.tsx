import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays } from "lucide-react";

/**
 * Editor-time inline content spec for `@event` mentions inside BlockNote
 * documents. Display-time rendering goes through `EventMentionChip` via
 * `BlockNoteRenderer`.
 *
 * Events are workspace-scoped reads (matches diagrams/tasks/projects in
 * CLAUDE.md), so every doc reader can resolve the title in the editor
 * preview without a permission branch.
 */
export const EventBlock = createReactInlineContentSpec(
  {
    type: "eventMention",
    propSchema: {
      eventId: { default: null as unknown as Id<"calendarEvents"> },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { eventId } = inlineContent.props;
      if (!eventId) {
        return (
          <span className="align-middle inline-flex items-center gap-1 p-1 rounded-full bg-destructive/20">
            <span className="font-medium">@Unknown Event</span>
          </span>
        );
      }
      return <EventInlineView eventId={eventId as Id<"calendarEvents">} />;
    },
  },
);

function EventInlineView({ eventId }: { eventId: Id<"calendarEvents"> }) {
  const result = useQuery(api.calendarEvents.get, { eventId });
  if (!result) {
    return <Skeleton className="inline-block h-6 w-24 rounded-full" />;
  }
  return (
    <span className="align-middle inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 dark:bg-purple-400/10 text-purple-700 dark:text-purple-300">
      <CalendarDays className="h-3 w-3 shrink-0" />
      <span className="font-medium">{result.event.title}</span>
    </span>
  );
}
