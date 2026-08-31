/**
 * The viewer's own answer to a **series**, and the one way to change it.
 *
 * There is one answer per person per series and no per-occurrence answer to
 * give (spec 0003, "RSVP"; ADR 0002), so this hook takes a series and never a
 * date. Every surface that offers the control — the series page, an
 * occurrence, and the override row a moved occurrence wears — answers the
 * same question through here, which is what makes "answering from either
 * records the same answer" true by construction rather than by three
 * call sites agreeing.
 *
 * Returns `null` when there is nothing to offer: the viewer is not on the
 * roster, or is the organizer (who does not RSVP to their own meeting, exactly
 * as on a one-off event), or the roster has not landed yet.
 */
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { toast } from "sonner";

import { getErrorMessage } from "@/lib/errors";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";

export type RsvpAnswer = "accepted" | "tentative" | "declined";

const CONFIRMATION: Record<RsvpAnswer, string> = {
  accepted: "Marked as going",
  tentative: "Marked as maybe",
  declined: "Declined",
};

export function useSeriesRsvp({
  seriesId,
  viewerId,
  organizerId,
}: {
  /** `null` while the surface does not yet know which series it is about. */
  seriesId: Id<"eventSeries"> | null;
  viewerId: Id<"users"> | undefined;
  organizerId: Id<"users"> | undefined;
}): {
  myStatus: Doc<"eventSeriesInvitees">["status"];
  respond: (status: RsvpAnswer) => Promise<void>;
} | null {
  // Workspace-scoped, like the series itself, and the same read the roster
  // uses — so an answer given here shows on the organizer's roster with no
  // second subscription.
  const invitees = useQuery(
    api.eventSeries.listInvitees,
    seriesId ? { seriesId } : "skip",
  );
  const respondMutation = useMutation(api.eventSeries.respond);

  const myRow =
    viewerId === undefined
      ? undefined
      : invitees?.find((row) => row.userId === viewerId);

  if (!seriesId || !myRow || viewerId === organizerId) return null;

  return {
    myStatus: myRow.status,
    respond: async (status: RsvpAnswer) => {
      try {
        await respondMutation({ seriesId, status });
        toast.success(CONFIRMATION[status]);
      } catch (err: unknown) {
        toast.error("Could not save response", {
          description: getErrorMessage(err),
        });
      }
    },
  };
}
