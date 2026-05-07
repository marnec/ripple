/**
 * Non-component exports for the event detail surfaces — constants, the
 * `useEventDetail` hook, and small formatters. Lives separately from
 * `event-detail-blocks.tsx` so that file can stay components-only and
 * keep Vite's React Fast Refresh happy.
 */

import { useMemo } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { toast } from "sonner";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { joinWindowStatus } from "../Dashboard/dashboard-calendar-utils";
import { useJoinStatusTick } from "./useJoinStatusTick";

// ───────────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────────

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const RSVP_LABEL: Record<
  "pending" | "accepted" | "tentative" | "declined",
  string
> = {
  pending: "Pending",
  accepted: "Going",
  tentative: "Maybe",
  declined: "Declined",
};

export const RSVP_BADGE_CLASS: Record<
  "pending" | "accepted" | "tentative" | "declined",
  string
> = {
  pending: "bg-muted text-muted-foreground",
  accepted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  tentative: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  declined: "bg-destructive/15 text-destructive",
};

// ───────────────────────────────────────────────────────────────────────────
// Formatters
// ───────────────────────────────────────────────────────────────────────────

/** Compact `<Day, Mon D, h:mm AM> – <h:mm AM>` representation for an
 *  event window. Used by the read-only When section. */
export function formatRange(startsAt: number, endsAt: number): string {
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

// ───────────────────────────────────────────────────────────────────────────
// Hook: useEventDetail
//
// Centralises everything both the sheet and the page need: queries,
// derived flags (isOrganizer, editable, hasGuests, callStatus), and
// mutation handlers wrapped with toasts. Destructive handlers return
// booleans so the calling shell can decide whether to navigate / close
// the surface after a successful operation.
// ───────────────────────────────────────────────────────────────────────────

export function useEventDetail({
  eventId,
  workspaceId,
}: {
  eventId: Id<"calendarEvents"> | null;
  workspaceId: Id<"workspaces">;
}) {
  const detail = useQuery(
    api.calendarEvents.get,
    eventId ? { eventId } : "skip",
  );
  const channels = useQuery(api.channels.list, { workspaceId });
  const members = useQuery(api.workspaceMembers.membersWithRoles, {
    workspaceId,
  });
  const viewer = useQuery(api.users.viewer);

  const update = useMutation(api.calendarEvents.update);
  const respond = useMutation(api.calendarEvents.respond);
  const cancel = useMutation(api.calendarEvents.cancel);
  const remove = useMutation(api.calendarEvents.remove);
  const addInvitees = useMutation(api.calendarEvents.addInvitees);
  const removeInvitee = useMutation(api.calendarEvents.removeInvitee);

  const myInvitee = useMemo(() => {
    if (!detail || !viewer) return undefined;
    return detail.invitees.find((i) => i.userId === viewer._id);
  }, [detail, viewer]);

  const isOrganizer = !!viewer && detail?.event.createdBy === viewer._id;
  const editable = isOrganizer && detail?.event.cancelledAt === undefined;
  const hasGuests = !!detail?.invitees.some(
    (i) => i.userId !== detail.event.createdBy,
  );

  // 30s tick so the Join window opens / closes without a refresh.
  const now = useJoinStatusTick();
  const callStatus =
    detail && detail.event.cancelledAt === undefined
      ? joinWindowStatus(detail.event.startsAt, detail.event.endsAt, now)
      : "ended";

  const saveField = async (
    label: string,
    args: Parameters<typeof update>[0],
  ) => {
    if (!eventId) return;
    try {
      await update(args);
      toast.success(`${label} saved`, { duration: 1500 });
    } catch (e) {
      toast.error(`Could not save ${label.toLowerCase()}`, {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleRespond = async (
    status: "accepted" | "declined" | "tentative",
  ) => {
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

  const handleCancel = async (): Promise<boolean> => {
    if (!eventId) return false;
    if (!confirm("Cancel this event? Invitees will be notified.")) return false;
    try {
      await cancel({ eventId });
      toast.success("Event cancelled");
      return true;
    } catch (e) {
      toast.error("Could not cancel event", {
        description: e instanceof Error ? e.message : undefined,
      });
      return false;
    }
  };

  const handleDelete = async (): Promise<boolean> => {
    if (!eventId || !detail) return false;
    const msg = hasGuests
      ? "Delete this event? It's already cancelled — invitees were already notified."
      : "Delete this event? This cannot be undone.";
    if (!confirm(msg)) return false;
    try {
      await remove({ eventId });
      toast.success("Event deleted");
      return true;
    } catch (e) {
      toast.error("Could not delete event", {
        description: e instanceof Error ? e.message : undefined,
      });
      return false;
    }
  };

  const handleAddInvitees = async (
    userIds: Id<"users">[],
    guestEmails: string[],
  ) => {
    if (!eventId || (userIds.length === 0 && guestEmails.length === 0)) return;
    try {
      await addInvitees({ eventId, userIds, guestEmails });
      const total = userIds.length + guestEmails.length;
      toast.success(`Invited ${total} ${total === 1 ? "person" : "people"}`);
    } catch (e) {
      toast.error("Could not add invitees", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleRemoveInvitee = async (
    inviteeId: Id<"calendarEventInvitees">,
  ) => {
    try {
      await removeInvitee({ inviteeId });
      toast.success("Invitee removed", { duration: 1500 });
    } catch (e) {
      toast.error("Could not remove invitee", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return {
    detail,
    channels,
    members,
    viewer,
    myInvitee,
    isOrganizer,
    editable,
    hasGuests,
    callStatus,
    saveField,
    handleRespond,
    handleCancel,
    handleDelete,
    handleAddInvitees,
    handleRemoveInvitee,
  };
}
