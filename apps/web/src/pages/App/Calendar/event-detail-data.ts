/**
 * Non-component exports for the event detail surfaces — constants, the
 * `useEventDetail` hook, and small formatters. Lives separately from
 * `event-detail-blocks.tsx` so that file can stay components-only and
 * keep Vite's React Fast Refresh happy.
 */

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
  // Events can be "hosted in" a channel — when set, the meeting reuses that
  // channel's persistent RealtimeKit room (see callSessions). `listHostable`
  // returns open + closed channels only; DMs are excluded server-side.
  const channels = useQuery(api.channels.listHostable, { workspaceId });
  const members = useQuery(api.workspaceMembers.membersWithRoles, {
    workspaceId,
  });
  const viewer = useQuery(api.users.viewer);

  const update = useMutation(api.calendarEvents.update);
  const respond = useMutation(api.calendarEvents.respond);
  const cancel = useMutation(api.calendarEvents.cancel);
  const addInvitees = useMutation(api.calendarEvents.addInvitees);
  const selfInvite = useMutation(api.calendarEvents.selfInvite);
  const removeInvitee = useMutation(api.calendarEvents.removeInvitee);

  const myInvitee =
    !detail || !viewer
      ? undefined
      : detail.invitees.find((i) => i.userId === viewer._id);

  // Cancellation is a hard delete (events have no soft-delete state). If
  // we have `detail`, the event still exists, so an organizer can edit it.
  const isOrganizer = !!viewer && detail?.event.createdBy === viewer._id;
  const editable = isOrganizer;
  const hasGuests = !!detail?.invitees.some(
    (i) => i.userId !== detail.event.createdBy,
  );

  // 30s tick so the Join window opens / closes without a refresh.
  const now = useJoinStatusTick();
  const callStatus = detail
    ? joinWindowStatus(detail.event.startsAt, detail.event.endsAt, now)
    : "ended";

  const saveField = async (
    label: string,
    args: Parameters<typeof update>[0],
  ) => {
    if (!eventId) return;
    try {
      await update(args);
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

  /** Cancel = hard delete with notifications. Invitees receive ICS CANCEL
   *  emails + in-app notifications, then the event row (and its node,
   *  edges, tags, shares, invitees) is dropped via cascade. There is no
   *  separate "delete" verb — cancellation is the only removal path. */
  const handleCancel = async (): Promise<boolean> => {
    if (!eventId) return false;
    // No confirmation here: this hook cannot render one, and a `confirm()` is
    // the wrong shape anyway. The caller asks first (`ConfirmDialog`), then
    // calls this — which is why `hasGuests` is returned, since it decides what
    // the question says.
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

  /** Organiser shortcut: drop a self-invite row at status="accepted"
   *  without firing the standard invite email/notification fan-out. The
   *  organiser is the only caller (server-side `assertOrganizer`),
   *  which matches the UX — the ghost row is only rendered for them. */
  const handleSelfInvite = async () => {
    if (!eventId) return;
    try {
      await selfInvite({ eventId });
      toast.success("Added you as an invitee", { duration: 1500 });
    } catch (e) {
      toast.error("Could not add you as invitee", {
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
    handleAddInvitees,
    handleSelfInvite,
    handleRemoveInvitee,
  };
}

/**
 * What the removal question asks, for both detail surfaces so they ask it
 * identically.
 *
 * Two things vary. Whether anyone is told — `willNotifyAnyone` is the hook's
 * `hasGuests`, which despite the name means "somebody other than me is on the
 * roster", members included. And whether this row is an **override**: an edited
 * occurrence of a repeating event, which the product navigates to straight
 * after the edit. Removing one of those skips a single occurrence and leaves
 * the series running, so calling it "Cancel event" told the organizer they were
 * deleting a meeting when they were dropping one week of it.
 */
export function removeEventDialogCopy({
  willNotifyAnyone,
  isOccurrenceOfSeries,
}: {
  willNotifyAnyone: boolean;
  isOccurrenceOfSeries: boolean;
}): {
  title: string;
  description: string;
  confirmLabel: string;
  dismissLabel: string;
} {
  if (isOccurrenceOfSeries) {
    return {
      title: "Skip this occurrence?",
      // No claim about who hears: the series roster is not on this row to
      // count, and a skip of an occurrence already past tells nobody.
      description:
        "Only this occurrence is removed. The rest of the repeating event carries on unchanged.",
      confirmLabel: "Skip occurrence",
      dismissLabel: "Keep it",
    };
  }
  return {
    title: "Cancel this event?",
    description: willNotifyAnyone
      ? "Invitees will be notified and the event will be removed. This cannot be undone."
      : "This cannot be undone.",
    confirmLabel: "Cancel event",
    dismissLabel: "Keep event",
  };
}
