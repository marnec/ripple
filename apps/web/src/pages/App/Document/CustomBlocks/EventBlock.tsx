import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { eventMentionTarget } from "@/lib/event-mention";
import { CalendarDays, Repeat } from "lucide-react";

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
      // A mention of a **series**. Declared here as well as on the chat spec,
      // or the doc editor would parse the prop away and a standup mention
      // pasted into a document would lose what it referred to.
      seriesId: { default: null as unknown as Id<"eventSeries"> },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const target = eventMentionTarget(inlineContent.props);
      if (target.kind === "unknown") {
        return (
          <span className="align-middle inline-flex items-center gap-1 p-1 rounded-full bg-destructive/20">
            <span className="font-medium">@Unknown Event</span>
          </span>
        );
      }
      return target.kind === "series" ? (
        <SeriesInlineView seriesId={target.seriesId} />
      ) : (
        <EventInlineView eventId={target.eventId} />
      );
    },
  },
);

function SeriesInlineView({ seriesId }: { seriesId: Id<"eventSeries"> }) {
  const series = useQuery(api.eventSeries.get, { seriesId });
  if (!series) {
    return <Skeleton className="inline-block h-6 w-24 rounded-full" />;
  }
  return <InlinePill title={series.title} repeating />;
}

function EventInlineView({ eventId }: { eventId: Id<"calendarEvents"> }) {
  const result = useQuery(api.calendarEvents.get, { eventId });
  if (!result) {
    return <Skeleton className="inline-block h-6 w-24 rounded-full" />;
  }
  return <InlinePill title={result.event.title} />;
}

function InlinePill({ title, repeating = false }: { title: string; repeating?: boolean }) {
  return (
    <span className="align-middle inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 dark:bg-purple-400/10 text-purple-700 dark:text-purple-300">
      {repeating ? (
        <Repeat className="h-3 w-3 shrink-0" />
      ) : (
        <CalendarDays className="h-3 w-3 shrink-0" />
      )}
      <span className="font-medium">{title}</span>
    </span>
  );
}
