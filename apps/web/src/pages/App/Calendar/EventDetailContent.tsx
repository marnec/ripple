import { Hash, Trash2, UserPlus } from "lucide-react";
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
  InviteAdder,
  PersonRow,
  ReadDateTime,
  ReadSection,
} from "./event-detail-blocks";
import { RSVP_BADGE_CLASS, RSVP_LABEL, type useEventDetail } from "./event-detail-data";

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
  members: Parameters<typeof InviteAdder>[0]["members"] | undefined;
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

      <InviteesSection
        detail={detail}
        members={members}
        editable={editable}
        viewerInvited={viewerInvited}
        handleAddInvitees={handleAddInvitees}
        handleSelfInvite={handleSelfInvite}
        handleRemoveInvitee={handleRemoveInvitee}
      />
    </div>
  );
}

/**
 * Invitees list + InviteAdder. Lifted out of the inline section that
 * was previously copy-pasted between Sheet (lines 232-305) and Page
 * (lines 316-380) — they had drifted in subtle ways (Page memoised the
 * existingUserIds Set; Sheet rebuilt it on every render) and now share
 * one implementation.
 */
function InviteesSection({
  detail,
  members,
  editable,
  viewerInvited,
  handleAddInvitees,
  handleSelfInvite,
  handleRemoveInvitee,
}: {
  detail: Detail;
  members: Parameters<typeof InviteAdder>[0]["members"] | undefined;
  editable: boolean;
  viewerInvited: boolean;
  handleAddInvitees: ReturnType<typeof useEventDetail>["handleAddInvitees"];
  handleSelfInvite: ReturnType<typeof useEventDetail>["handleSelfInvite"];
  handleRemoveInvitee: ReturnType<typeof useEventDetail>["handleRemoveInvitee"];
}) {
  const existingUserIds = new Set(
    detail.invitees
      .map((i) => i.userId)
      .filter((id): id is Id<"users"> => !!id),
  );
  const existingGuestEmails = new Set(
    detail.invitees
      .map((i) => i.guestEmail)
      .filter((e): e is string => !!e),
  );

  // Ghost CTA at the top of the list. Shown when the viewer is the
  // organiser (`editable`) and hasn't already invited themselves —
  // keeps organiser↔event out of the knowledge graph by default while
  // making opt-in a single click. Reappears if the organiser later
  // removes their own invitee row.
  const showSelfInvite = editable && !viewerInvited;

  return (
    <section>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Invitees
        </p>
        <span className="text-xs text-muted-foreground tabular-nums">
          {detail.invitees.length}
        </span>
      </div>
      {detail.invitees.length === 0 && !showSelfInvite ? (
        <p className="text-xs text-muted-foreground">No one invited yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {showSelfInvite && (
            <li>
              <button
                type="button"
                onClick={() => void handleSelfInvite()}
                className="w-full flex items-center gap-2 text-sm rounded-md border border-dashed border-muted-foreground/30 px-2 py-1.5 text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted/40 transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Add yourself as invitee</span>
              </button>
            </li>
          )}
          {detail.invitees.map((inv) => (
            <li
              key={inv._id}
              className="group flex items-center gap-2 text-sm"
            >
              <PersonRow
                name={
                  inv.userName ??
                  inv.guestName ??
                  inv.guestEmail ??
                  "Invitee"
                }
                image={inv.userImage}
                guest={!inv.userId}
                subtitle={inv.userId ? inv.userEmail : "Guest"}
              />
              <span
                className={cn(
                  "ml-auto text-[11px] px-1.5 py-0.5 rounded font-medium",
                  RSVP_BADGE_CLASS[inv.status],
                )}
              >
                {RSVP_LABEL[inv.status]}
              </span>
              {editable && (
                <button
                  type="button"
                  onClick={() => void handleRemoveInvitee(inv._id)}
                  aria-label={`Remove ${inv.userName ?? inv.guestEmail ?? "invitee"}`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <InviteAdder
          members={members ?? []}
          existingUserIds={existingUserIds}
          existingGuestEmails={existingGuestEmails}
          organizerId={detail.event.createdBy}
          onSubmit={handleAddInvitees}
        />
      )}
    </section>
  );
}
