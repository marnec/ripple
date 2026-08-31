import { Hash } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";

import { cn } from "@/lib/utils";
import { TagInput } from "@/components/TagInput";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  EditableChannel,
  EditableDateTime,
  EditableDescription,
  PersonRow,
  ReadDateTime,
  ReadSection,
} from "./event-detail-blocks";
import type { useEventDetail } from "./event-detail-data";
import { InviteeRoster, type RosterCandidate } from "./InviteeRoster";

type Detail = NonNullable<ReturnType<typeof useEventDetail>["detail"]>;

/**
 * Shared body for the event-detail surfaces. Renders the field stack
 * (DateTime / Channel / Description / Organizer / Invitees) that both
 * `EventDetailSheet` (desktop side panel) and `EventDetailPage` (full
 * route) display verbatim.
 *
 * Title placement differs between surfaces (sheet renders it inside
 * `<SheetTitle>`; page renders it as an inline `<h1>`) so it stays out
 * of this component — wrappers continue to own their own title block.
 *
 * `gap` lets the Page surface use a roomier spacing (`gap-7`) than the
 * Sheet (`gap-5`); the rest of the layout is identical.
 */
export function EventDetailContent({
  detail,
  channels,
  members,
  editable,
  workspaceId,
  saveField,
  handleAddInvitees,
  handleSelfInvite,
  handleRemoveInvitee,
  viewerInvited,
  gapClassName = "gap-5",
  channelDisplay = "inline",
}: {
  detail: Detail;
  channels: { _id: Id<"channels">; name: string }[] | undefined;
  members: RosterCandidate[] | undefined;
  editable: boolean;
  workspaceId: Id<"workspaces">;
  saveField: ReturnType<typeof useEventDetail>["saveField"];
  handleAddInvitees: ReturnType<typeof useEventDetail>["handleAddInvitees"];
  handleSelfInvite: ReturnType<typeof useEventDetail>["handleSelfInvite"];
  handleRemoveInvitee: ReturnType<typeof useEventDetail>["handleRemoveInvitee"];
  /** Whether the current viewer already has a row in `detail.invitees`.
   *  Drives the "Add yourself" ghost row at the top of the list. */
  viewerInvited: boolean;
  /** Tailwind gap class applied to the field column. */
  gapClassName?: string;
  /** Sheet renders the read-only channel as a bare button row; the page
   *  wraps it in a `ReadSection` with a heading. */
  channelDisplay?: "inline" | "section";
}) {
  const navigate = useNavigate();
  const updateEventTags = useMutation(api.calendarEvents.updateEventTags);

  return (
    <div className={cn("flex flex-col", gapClassName)}>
      {editable ? (
        <EditableDateTime
          startsAt={detail.event.startsAt}
          endsAt={detail.event.endsAt}
          onSave={(startsAt, endsAt) =>
            saveField("Time", {
              eventId: detail.event._id,
              startsAt,
              endsAt,
            })
          }
        />
      ) : (
        <ReadDateTime
          startsAt={detail.event.startsAt}
          endsAt={detail.event.endsAt}
        />
      )}

      {editable ? (
        <EditableChannel
          value={detail.event.channelId ?? ""}
          channels={channels ?? []}
          onSave={(channelId) =>
            saveField("Channel", {
              eventId: detail.event._id,
              channelId: channelId
                ? (channelId as Id<"channels">)
                : null,
            })
          }
        />
      ) : detail.channelName && detail.event.channelId ? (
        channelDisplay === "section" ? (
          <ReadSection
            icon={<Hash className="h-3.5 w-3.5" />}
            label="Hosted in"
          >
            <button
              type="button"
              className="flex items-center gap-2 text-sm hover:underline self-start"
              onClick={() => {
                void navigate(
                  `/workspaces/${workspaceId}/channels/${detail.event.channelId}`,
                );
              }}
            >
              <Hash className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{detail.channelName}</span>
            </button>
          </ReadSection>
        ) : (
          <button
            type="button"
            className="flex items-center gap-2 text-sm hover:underline self-start"
            onClick={() => {
              void navigate(
                `/workspaces/${workspaceId}/channels/${detail.event.channelId}`,
              );
            }}
          >
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Hosted in</span>
            <span className="font-medium">{detail.channelName}</span>
          </button>
        )
      ) : null}

      {editable ? (
        <EditableDescription
          value={detail.event.description ?? ""}
          onSave={(description) =>
            saveField("Description", {
              eventId: detail.event._id,
              description,
            })
          }
        />
      ) : detail.event.description ? (
        <ReadSection label="Description">
          <p className="text-sm whitespace-pre-wrap">
            {detail.event.description}
          </p>
        </ReadSection>
      ) : null}

      {/* Tags. Editable inline for organisers; read-only chips otherwise.
          Wires into the polymorphic `entityTags` system via
          `calendarEvents.updateEventTags`, mirroring documents/diagrams. */}
      {editable ? (
        <ReadSection label="Tags">
          <TagInput
            value={detail.event.tags ?? []}
            onChange={(tags) =>
              void updateEventTags({ eventId: detail.event._id, tags })
            }
            workspaceId={workspaceId}
            placeholder="Add tags…"
          />
        </ReadSection>
      ) : detail.event.tags && detail.event.tags.length > 0 ? (
        <ReadSection label="Tags">
          <div className="flex flex-wrap gap-1.5">
            {detail.event.tags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-muted text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </ReadSection>
      ) : null}

      <ReadSection label="Organizer">
        <PersonRow
          name={detail.organizer.name ?? detail.organizer.email ?? "Unknown"}
          image={detail.organizer.image}
        />
      </ReadSection>

      {/* Passing `onSelfInvite` is what offers the ghost "add yourself" row,
          so an organiser already on the roster simply doesn't get one. A
          one-off event is the only thing that offers it today. */}
      <InviteeRoster
        invitees={detail.invitees}
        editable={editable}
        members={members}
        organizerId={detail.event.createdBy}
        onAdd={handleAddInvitees}
        onRemove={handleRemoveInvitee}
        onSelfInvite={viewerInvited ? undefined : handleSelfInvite}
      />
    </div>
  );
}

