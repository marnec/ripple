import { CalendarDays } from "lucide-react";
import { useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

type EventSuggestionsOptions = {
  workspaceId: Id<"workspaces"> | undefined;
  editor: any;
  /**
   * Inline-content type to insert when an event is picked. Defaults to
   * `eventMention` — the canonical name across chat, doc, and task surfaces.
   */
  mentionType?: string;
  /** Max events per group (upcoming / recent). Default 8. */
  limit?: number;
};

/**
 * Returns a `getItems` callback for BlockNote's
 * `<SuggestionMenuController triggerCharacter="@">` that surfaces calendar
 * events alongside member mentions.
 *
 * Events are workspace-scoped (see CLAUDE.md — same model as diagrams/tasks),
 * so every workspace member sees the same suggestion set. The server query
 * uses a full-text search index on title when the user types text and a
 * tight `[now − 7d, now + 30d]` range scan for the empty-query browse case.
 */
export function useEventSuggestions({
  workspaceId,
  editor,
  mentionType = "eventMention",
  limit = 8,
}: EventSuggestionsOptions) {
  const convex = useConvex();
  return async (query: string) => {
    if (!workspaceId) return [];
    const trimmed = query.trim();
    const results = await convex.query(api.calendarEvents.listForMentionAutocomplete, {
      workspaceId,
      query: trimmed.length > 0 ? trimmed : undefined,
      limit,
    });

    return results.map((e) => ({
      title: e.title,
      subtext: formatWhen(e.startsAt),
      onItemClick: () => {
        editor.insertInlineContent([
          { type: mentionType, props: { eventId: e.eventId } },
          " ",
        ]);
      },
      icon: <CalendarDays className="h-4 w-4 text-purple-600 dark:text-purple-400" />,
      group: e.group === "upcoming" ? "Upcoming" : "Recent",
    }));
  };
}

/** Compact "Mon, May 12 · 10:00" for the suggestion subtext. */
function formatWhen(ts: number): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}
