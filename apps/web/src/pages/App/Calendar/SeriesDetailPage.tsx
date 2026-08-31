/**
 * The **series** as a resource, at
 * `/workspaces/:workspaceId/events/:seriesId/series`.
 *
 * The pattern's own page, as distinct from any one Tuesday of it. An
 * occurrence is reached at `/events/:seriesId?on=<originalStartMs>`, and a
 * *bare* `/events/:seriesId` resolves to whichever occurrence is next — which
 * is why the series needs a URL of its own rather than borrowing the bare one:
 * without it there would be no way to say "the standup" rather than "the next
 * standup".
 *
 * What lives here is what belongs to the whole series: its name, what it says,
 * how it repeats, where it meets, its tags, and who is invited. Editing the
 * *rule* — moving the time, changing the recurrence, splitting from one
 * occurrence onward — is a scoped edit and is not offered here.
 *
 * The roster is on this page and on no other. Invite someone once and they are
 * invited to all of it; remove them once and they are gone from all of it — a
 * roster row is filed under the series, never under one Tuesday of it, so
 * there is nothing an occurrence could offer a control over (ADR 0002).
 */
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarClock, Hash, Repeat } from "lucide-react";
import { toast } from "sonner";

import { RippleSpinner } from "@/components/RippleSpinner";
import { TagInput } from "@/components/TagInput";
import { MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { getErrorMessage } from "@/lib/errors";
import { useViewer } from "@/pages/App/UserContext";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { api } from "@convex/_generated/api";
import type { QueryParams } from "@convex/types/routes";
import type { Id } from "@convex/_generated/dataModel";
import { nextOccurrenceFrom } from "@ripple/shared/recurrence";

import { EditableTitle, ReadSection } from "./event-detail-blocks";
import { InviteeRoster } from "./InviteeRoster";
import { RsvpResponseGroup } from "./RsvpResponseGroup";
import { useSeriesRsvp } from "./use-series-rsvp";
import { describeOccurrenceInSeries } from "./occurrence-summary";
import { useJoinStatusTick } from "./useJoinStatusTick";
import { toSeriesDefinition } from "./series-definition";

export function SeriesDetailPage() {
  const { workspaceId, eventId } = useParams<
    QueryParams & { eventId?: string }
  >();
  if (!workspaceId || !eventId) return <SomethingWentWrong />;
  return (
    <SeriesDetailContent
      workspaceId={workspaceId}
      seriesId={eventId as Id<"eventSeries">}
    />
  );
}

function SeriesDetailContent({
  workspaceId,
  seriesId,
}: {
  workspaceId: Id<"workspaces">;
  seriesId: Id<"eventSeries">;
}) {
  const navigate = useNavigate();
  const viewer = useViewer();
  // A clock that re-renders on its own, so "next occurrence" rolls forward on
  // a page left open across the meeting rather than freezing on a date that
  // has already passed.
  const now = useJoinStatusTick();
  const series = useQuery(api.eventSeries.get, { seriesId });
  const channel = useQuery(
    api.channels.get,
    series?.channelId ? { id: series.channelId } : "skip",
  );
  // The roster, and the people who could be added to it. Both are the
  // *series'* — there is no per-occurrence roster to ask for.
  const invitees = useQuery(api.eventSeries.listInvitees, { seriesId });
  const members = useQuery(api.workspaceMembers.membersWithRoles, {
    workspaceId,
  });
  const rename = useMutation(api.eventSeries.rename);
  const updateTags = useMutation(api.eventSeries.updateTags);
  const addInvitees = useMutation(api.eventSeries.addInvitees);
  const selfInvite = useMutation(api.eventSeries.selfInvite);
  const removeInvitee = useMutation(api.eventSeries.removeInvitee);
  // One answer for the whole ritual. Offered here *and* on every occurrence —
  // the same hook against the same series — so it is one answer wherever it
  // is given (spec 0003, "RSVP").
  const rsvp = useSeriesRsvp({
    seriesId,
    viewerId: viewer?._id,
    organizerId: series?.createdBy,
  });

  if (series === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <RippleSpinner />
      </div>
    );
  }
  if (series === null) return <ResourceDeleted resourceType="event" />;

  const definition = toSeriesDefinition(series);
  const next = nextOccurrenceFrom(definition, now);
  const editable = viewer?._id === series.createdBy;

  const save = async (
    label: string,
    run: () => Promise<unknown>,
  ): Promise<void> => {
    try {
      await run();
    } catch (err: unknown) {
      toast.error(`Could not save ${label}`, {
        description: getErrorMessage(err),
      });
    }
  };

  const handleAddInvitees = async (
    userIds: Id<"users">[],
    guestEmails: string[],
  ): Promise<void> => {
    if (userIds.length === 0 && guestEmails.length === 0) return;
    try {
      await addInvitees({ seriesId, userIds, guestEmails });
      const total = userIds.length + guestEmails.length;
      toast.success(`Invited ${total} ${total === 1 ? "person" : "people"}`);
    } catch (err: unknown) {
      // The invitee cap arrives here as a `ConvexError` and is said out loud.
      // An add that quietly did nothing is the one outcome an organizer cannot
      // tell apart from success.
      toast.error("Could not add invitees", {
        description: getErrorMessage(err),
      });
    }
  };

  /** The organizer joining their own ritual. Silent server-side — nobody is
   *  notified, least of all them — so the toast is the only acknowledgement
   *  there is, and it is what tells the click apart from a dead button. */
  const handleSelfInvite = async (): Promise<void> => {
    try {
      await selfInvite({ seriesId });
      toast.success("Added you as an invitee", { duration: 1500 });
    } catch (err: unknown) {
      toast.error("Could not add you as invitee", {
        description: getErrorMessage(err),
      });
    }
  };

  const handleRemoveInvitee = async (
    inviteeId: Id<"eventSeriesInvitees">,
  ): Promise<void> => {
    try {
      await removeInvitee({ inviteeId });
      toast.success("Invitee removed", { duration: 1500 });
    } catch (err: unknown) {
      toast.error("Could not remove invitee", {
        description: getErrorMessage(err),
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MobileHeaderTitle name={series.title} />
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-6">
        {editable ? (
          <EditableTitle
            value={series.title}
            size="lg"
            onSave={(title) => save("the name", () => rename({ seriesId, title }))}
          />
        ) : (
          <h1 className="text-2xl font-semibold tracking-tight">{series.title}</h1>
        )}

        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Repeat className="h-3.5 w-3.5 shrink-0" />
          {/* Described from the next occurrence, so a monthly "on the first
              Tuesday" is named from a date the rule actually produces. */}
          {describeOccurrenceInSeries(
            definition,
            next?.originalStartMs ?? now,
          )}
        </p>

        {rsvp && (
          <RsvpResponseGroup
            myStatus={rsvp.myStatus}
            onRespond={(status) => void rsvp.respond(status)}
            className="mt-6 max-w-md"
            buttonClassName="flex-1"
          />
        )}

        <div className="mt-6 flex flex-col gap-6">
          {next && (
            <ReadSection
              icon={<CalendarClock className="h-3.5 w-3.5" />}
              label="Next occurrence"
            >
              <button
                type="button"
                className="self-start text-sm hover:underline"
                onClick={() =>
                  void navigate(
                    `/workspaces/${workspaceId}/events/${seriesId}?on=${next.originalStartMs}`,
                  )
                }
              >
                {formatWhen(next.startsAt, next.endsAt)}
              </button>
            </ReadSection>
          )}

          {series.channelId && channel && (
            <ReadSection icon={<Hash className="h-3.5 w-3.5" />} label="Hosted in">
              <button
                type="button"
                className="flex items-center gap-2 self-start text-sm hover:underline"
                onClick={() =>
                  void navigate(
                    `/workspaces/${workspaceId}/channels/${series.channelId}`,
                  )
                }
              >
                <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{channel.name}</span>
              </button>
            </ReadSection>
          )}

          {series.description && (
            <ReadSection label="Description">
              <p className="whitespace-pre-wrap text-sm">{series.description}</p>
            </ReadSection>
          )}

          {/* Tags belong to the series and to nothing else: one set for the
              ritual, never one per Tuesday (ADR 0002). */}
          {editable ? (
            <ReadSection label="Tags">
              <TagInput
                value={series.tags ?? []}
                onChange={(tags) =>
                  void save("the tags", () => updateTags({ seriesId, tags }))
                }
                workspaceId={workspaceId}
                placeholder="Add tags…"
              />
            </ReadSection>
          ) : series.tags && series.tags.length > 0 ? (
            <ReadSection label="Tags">
              <div className="flex flex-wrap gap-1.5">
                {series.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </ReadSection>
          ) : null}

          {/* One roster for the whole ritual, and the only place it is
              offered. `onSelfInvite` is passed only while the organizer is off
              the roster, which is what makes the ghost row appear and then
              stop appearing: they are not on their own series unless they ask
              to be, because an edge to every meeting they book would say
              nothing about any of them.

              Held back until the roster query answers: it is a second query
              and lands after the series, and "No one invited yet" is a claim
              that would be wrong for as long as it took to arrive. */}
          {invitees !== undefined && (
            <InviteeRoster
              invitees={invitees}
              editable={editable}
              members={members}
              organizerId={series.createdBy}
              onAdd={handleAddInvitees}
              onRemove={handleRemoveInvitee}
              onSelfInvite={
                invitees.some((i) => i.userId === series.createdBy)
                  ? undefined
                  : handleSelfInvite
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** "Tuesday, 15 September 2026 · 09:00 – 09:30" */
function formatWhen(startsAt: number, endsAt: number): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const date = start.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time(start)} – ${time(end)}`;
}
