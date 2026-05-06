/**
 * Event detail surface — read view for non-organisers, inline edit-in-place
 * for organisers. Each editable cell is independent: a click promotes it
 * into the right input/popover, blur or Enter commits, Esc reverts. Saves
 * are autosave-per-field (no global "save" button) so the sheet feels like
 * a Linear/Notion surface rather than a form modal.
 *
 * Aesthetic notes:
 *   • Read state: bare text with section labels above. The faint
 *     `hover:bg-muted/40` lift on editable rows is the only chrome — no
 *     borders, no field backgrounds. Affordance comes from a pencil icon
 *     that fades in on row hover (`group-hover:opacity-100`).
 *   • Edit state: the row morphs into a popover trigger / input. A
 *     subtle `ring-1 ring-ring/30` replaces the hover lift to mark focus
 *     without shouting.
 *   • Editing is gated to organisers on non-cancelled events. Cancelled
 *     events are deliberately read-only — the path back is restore (out
 *     of scope) not edit.
 */

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useNavigate } from "react-router-dom";
import {
  Hash,
  Pencil,
  Trash2,
  Video,
  CalendarDays as CalendarDaysIcon,
  Clock,
  AlignLeft,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { InviteeMultiSelect } from "@/components/InviteeMultiSelect";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  joinWindowStatus,
  parseEmailChips,
} from "../Dashboard/dashboard-calendar-utils";
import {
  ChannelCombobox,
  DatePopover,
  TimeSelect,
} from "./event-fields";
import { combineDateAndTime, msToExactTime } from "./event-time-utils";

// ───────────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const RSVP_LABEL: Record<"pending" | "accepted" | "tentative" | "declined", string> = {
  pending: "Pending",
  accepted: "Going",
  tentative: "Maybe",
  declined: "Declined",
};

const RSVP_BADGE_CLASS: Record<"pending" | "accepted" | "tentative" | "declined", string> = {
  pending: "bg-muted text-muted-foreground",
  accepted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  tentative: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  declined: "bg-destructive/15 text-destructive",
};

// ───────────────────────────────────────────────────────────────────────────
// Sheet shell
// ───────────────────────────────────────────────────────────────────────────

export function EventDetailSheet({
  eventId,
  open,
  onOpenChange,
  workspaceId,
}: {
  eventId: Id<"calendarEvents"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: Id<"workspaces">;
}) {
  const detail = useQuery(
    api.calendarEvents.get,
    eventId ? { eventId } : "skip",
  );
  const channels = useQuery(api.channels.list, { workspaceId });
  // Workspace members feed the invitee picker. Loaded only when an event
  // is open so we don't pay for the subscription on cold renders. Same
  // membersWithRoles query that CreateEventDialog uses, so the Convex
  // server-side dedupes the subscription across both surfaces.
  const members = useQuery(
    api.workspaceMembers.membersWithRoles,
    { workspaceId },
  );
  const respond = useMutation(api.calendarEvents.respond);
  const cancel = useMutation(api.calendarEvents.cancel);
  const remove = useMutation(api.calendarEvents.remove);
  const update = useMutation(api.calendarEvents.update);
  const addInvitees = useMutation(api.calendarEvents.addInvitees);
  const removeInvitee = useMutation(api.calendarEvents.removeInvitee);
  const navigate = useNavigate();

  const viewer = useQuery(api.users.viewer);

  const myInvitee = useMemo(() => {
    if (!detail || !viewer) return undefined;
    return detail.invitees.find((i) => i.userId === viewer._id);
  }, [detail, viewer]);

  const isOrganizer = !!viewer && detail?.event.createdBy === viewer._id;
  const editable = isOrganizer && detail?.event.cancelledAt === undefined;
  const hasGuests = !!detail?.invitees.some(
    (i) => i.userId !== detail.event.createdBy,
  );

  // `now` ticks every 30s while the sheet is open so the Join button
  // appears/disappears across the join window without a manual refresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [open]);
  const callStatus =
    detail && detail.event.cancelledAt === undefined
      ? joinWindowStatus(detail.event.startsAt, detail.event.endsAt, now)
      : "ended";

  const handleRespond = async (status: "accepted" | "declined" | "tentative") => {
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

  const handleCancel = async () => {
    if (!eventId) return;
    if (!confirm("Cancel this event? Invitees will be notified.")) return;
    try {
      await cancel({ eventId });
      toast.success("Event cancelled");
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not cancel event", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleDelete = async () => {
    if (!eventId || !detail) return;
    const msg = hasGuests
      ? "Delete this event? It's already cancelled — invitees were already notified."
      : "Delete this event? This cannot be undone.";
    if (!confirm(msg)) return;
    try {
      await remove({ eventId });
      toast.success("Event deleted");
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not delete event", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const joinCall = () => {
    if (!eventId) return;
    void navigate(
      `/workspaces/${workspaceId}/calendar/events/${eventId}/videocall`,
    );
  };

  // Invitee handlers — both wrapped with toast feedback. The picker
  // section below owns the in-flight selection state; on commit we hand
  // off the lists to addInvitees and reset.
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

  // Field-level autosave wrappers — each takes only the changed slice and
  // wraps the mutation with a toast. The Convex `update` is patch-shaped,
  // so partial calls are cheap.
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* The base SheetContent applies `data-[side=right]:sm:max-w-sm`
          (24rem) — a plain `sm:max-w-xl` here loses on selector
          specificity and twMerge can't dedupe across mismatched modifier
          signatures. Match the source-of-truth selector exactly so the
          override wins. The `data-[side=right]:w-3/4` underneath is fine:
          at desktop widths 75vw is much larger than max-w-xl (36rem), so
          the cap still controls the visible width. */}
      <SheetContent
        side="right"
        className="data-[side=right]:sm:max-w-xl flex flex-col gap-0 p-0"
      >
        {!detail ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            {detail === null ? "Event not found" : null}
          </div>
        ) : (
          <>
            {/* ───── Header: title row + cancelled badge ───── */}
            <SheetHeader className="p-4 pb-3 border-b">
              <div className="flex items-start gap-2 pr-8">
                <CalendarDaysIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                {editable ? (
                  <EditableTitle
                    value={detail.event.title}
                    onSave={(title) =>
                      saveField("Title", { eventId: detail.event._id, title })
                    }
                  />
                ) : (
                  <SheetTitle className="text-base truncate">
                    {detail.event.title}
                  </SheetTitle>
                )}
              </div>
              {detail.event.cancelledAt !== undefined && (
                <div className="mt-1.5">
                  <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-destructive/15 text-destructive uppercase tracking-wide">
                    Cancelled
                  </span>
                </div>
              )}
            </SheetHeader>

            {/* ───── Body ───── */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
              {/* Date / time block */}
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

              {/* Channel link / picker */}
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
                  <span className="text-muted-foreground">Linked to</span>
                  <span className="font-medium">{detail.channelName}</span>
                </button>
              ) : null}

              {/* Description */}
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
                <ReadSection icon={<AlignLeft className="h-3.5 w-3.5" />} label="Description">
                  <p className="text-sm whitespace-pre-wrap">
                    {detail.event.description}
                  </p>
                </ReadSection>
              ) : null}

              {/* Organizer */}
              <ReadSection label="Organizer">
                <PersonRow
                  name={detail.organizer.name ?? detail.organizer.email ?? "Unknown"}
                  image={detail.organizer.image}
                />
              </ReadSection>

              {/* Invitees — list + add picker (organizer only). The picker
                  lives below the existing list so newly-added invitees
                  visibly appear above where the user just typed; matches
                  Slack/Google's "what I just did" reading flow. */}
              <section>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Invitees
                  </p>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {detail.invitees.length}
                  </span>
                </div>
                {detail.invitees.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No one invited yet.</p>
                ) : (
                  <ul className="space-y-1.5">
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
                        {/* Remove-invitee × — fades in on row hover for
                            organisers on non-cancelled events. Hidden
                            otherwise so the read view stays calm. */}
                        {editable && (
                          <button
                            type="button"
                            onClick={() => void handleRemoveInvitee(inv._id)}
                            aria-label={`Remove ${inv.userName ?? inv.guestEmail ?? "invitee"}`}
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {editable && (
                  <InviteAdder
                    members={members ?? []}
                    existingUserIds={new Set(
                      detail.invitees
                        .map((i) => i.userId)
                        .filter((id): id is Id<"users"> => !!id),
                    )}
                    existingGuestEmails={new Set(
                      detail.invitees
                        .map((i) => i.guestEmail)
                        .filter((e): e is string => !!e),
                    )}
                    organizerId={detail.event.createdBy}
                    onSubmit={handleAddInvitees}
                  />
                )}
              </section>
            </div>

            {/* ───── Footer actions ───── */}
            <div className="border-t p-3 flex flex-col gap-2">
              {callStatus === "open" && detail.event.cancelledAt === undefined && (
                <Button onClick={joinCall} className="w-full">
                  <Video className="h-4 w-4 mr-1.5" />
                  Join call
                </Button>
              )}
              {callStatus === "pending" && (
                <p className="text-xs text-center text-muted-foreground">
                  Join opens 5 minutes before the event.
                </p>
              )}

              {!isOrganizer && myInvitee && detail.event.cancelledAt === undefined && (
                <div className="grid grid-cols-3 gap-1.5">
                  <Button
                    type="button"
                    variant={myInvitee.status === "accepted" ? "default" : "outline"}
                    size="sm"
                    onClick={() => void handleRespond("accepted")}
                  >
                    Going
                  </Button>
                  <Button
                    type="button"
                    variant={myInvitee.status === "tentative" ? "default" : "outline"}
                    size="sm"
                    onClick={() => void handleRespond("tentative")}
                  >
                    Maybe
                  </Button>
                  <Button
                    type="button"
                    variant={myInvitee.status === "declined" ? "default" : "outline"}
                    size="sm"
                    onClick={() => void handleRespond("declined")}
                  >
                    Decline
                  </Button>
                </div>
              )}

              {/* Organizer destructive actions. Cancel is purpose-built
                  for events with guests (see README + earlier triage):
                  it sends notifications + revokes share links and leaves
                  a tombstone. Delete is the hard-remove and routes
                  through the `remove` mutation, which itself refuses to
                  delete a non-cancelled guest event so users can't ghost
                  invitees. We surface them on the same row when both are
                  applicable; otherwise just the relevant one. */}
              {isOrganizer && (
                <div className="flex items-center gap-1.5">
                  {detail.event.cancelledAt === undefined && hasGuests && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-destructive hover:text-destructive"
                      onClick={() => void handleCancel()}
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" />
                      Cancel event
                    </Button>
                  )}
                  {/* Delete is allowed when there are no guests (always)
                      OR the event is already cancelled. Other states
                      route the user to Cancel first. */}
                  {(!hasGuests || detail.event.cancelledAt !== undefined) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-destructive hover:text-destructive"
                      onClick={() => void handleDelete()}
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" />
                      Delete event
                    </Button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// EditableTitle — click-to-edit single-line title.
//
// Behaviour: at rest looks like the existing SheetTitle. On click the row
// swaps in an Input pre-filled with the current title and auto-focused.
// Enter / blur with a real diff calls `onSave`; Esc reverts. Empty titles
// are rejected by the schema, so we guard locally too.
// ───────────────────────────────────────────────────────────────────────────

function EditableTitle({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void | Promise<void>;
}) {
  // `editing` doubles as the source of truth for the draft: when null we
  // render `value` straight from props (so external concurrent updates
  // appear immediately); when a string, that's the in-flight edit.
  // Storing the draft this way avoids a sync-from-prop effect, which
  // would trigger react-hooks/set-state-in-effect.
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = draft !== null;

  const startEditing = () => setDraft(value);

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next === "" || next === value.trim()) return; // no-op
    void onSave(next);
  };

  const cancel = () => setDraft(null);

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft ?? ""}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        // Visual: borrow the same scale/typography as the title at rest so
        // the morph is purely a chrome change, not a layout jump.
        className="h-7 px-1.5 text-base font-semibold"
      />
    );
  }

  return (
    // SheetTitle wraps the visible label so Radix's a11y labelling
    // hooks up correctly. The button outside it carries the click target
    // and hover affordance — keeping the title inline-block lets the
    // pencil sit flush to the right of the title text instead of below.
    <button
      type="button"
      onClick={startEditing}
      className="group flex items-center gap-1.5 text-left min-w-0 -mx-1.5 px-1.5 py-0.5 rounded-md hover:bg-muted/50 transition-colors"
    >
      <SheetTitle className="text-base font-semibold truncate">
        {value}
      </SheetTitle>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// InviteAdder — self-contained add-invitees affordance.
//
// Collapsed state: a slim "Invite people" link button. Opens the picker
// inline below the existing invitee list — chosen rather than a modal so
// the act of inviting feels continuous with the existing list above.
//
// Open state:
//   • InviteeMultiSelect (members combobox + email field, mirrors
//     CreateEventDialog so the picker is identical across surfaces)
//   • Pending chips below it
//   • An Add button that commits via `onSubmit` and resets the local
//     state. The Add button is disabled until at least one invitee is
//     queued, so accidental empty submits are impossible.
//
// Already-invited members and the organiser are filtered out of the
// member options so users can't shadow-invite duplicates (the server
// would reject these too, but local filtering is cleaner UX).
// ───────────────────────────────────────────────────────────────────────────

function InviteAdder({
  members,
  existingUserIds,
  existingGuestEmails,
  organizerId,
  onSubmit,
}: {
  members:
    | { userId: Id<"users">; name?: string; email?: string; image?: string }[]
    | undefined;
  existingUserIds: Set<Id<"users">>;
  existingGuestEmails: Set<string>;
  organizerId: Id<"users">;
  onSubmit: (
    userIds: Id<"users">[],
    guestEmails: string[],
  ) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [memberIds, setMemberIds] = useState<Id<"users">[]>([]);
  const [guestEmails, setGuestEmails] = useState<string[]>([]);
  const [invalidEmail, setInvalidEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter(
          (m) => m.userId !== organizerId && !existingUserIds.has(m.userId),
        )
        .map((m) => ({
          userId: m.userId,
          name: m.name ?? m.email ?? "Unknown",
          email: m.email,
          image: m.image,
        })),
    [members, existingUserIds, organizerId],
  );

  const reset = () => {
    setMemberIds([]);
    setGuestEmails([]);
    setInvalidEmail(null);
  };

  const handleAddEmail = (raw: string) => {
    const { valid, invalid } = parseEmailChips(raw);
    setInvalidEmail(invalid[0] ?? null);
    if (valid.length === 0) return;
    setGuestEmails((prev) =>
      Array.from(
        new Set([
          ...prev,
          // Drop emails already invited on the server side.
          ...valid.filter((v) => !existingGuestEmails.has(v.toLowerCase())),
        ]),
      ),
    );
  };

  const totalQueued = memberIds.length + guestEmails.length;

  const handleSubmit = async () => {
    if (totalQueued === 0) return;
    setSubmitting(true);
    try {
      await onSubmit(memberIds, guestEmails);
      reset();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <UserPlus className="h-3.5 w-3.5" />
        Invite people
      </button>
    );
  }

  return (
    // Bordered container distinguishes the "compose row" from the
    // ambient sheet so the picker reads as a discrete action zone
    // rather than another inert section.
    <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-3 flex flex-col gap-2">
      <InviteeMultiSelect
        members={memberOptions}
        selectedMemberIds={memberIds}
        onSelectedMemberIdsChange={setMemberIds}
        guestEmails={guestEmails}
        onAddEmail={handleAddEmail}
        onRemoveEmail={(email) =>
          setGuestEmails((prev) => prev.filter((e) => e !== email))
        }
      />
      {invalidEmail && (
        <p className="text-xs text-destructive">
          "{invalidEmail}" doesn't look like a valid email
        </p>
      )}
      {(memberIds.length > 0 || guestEmails.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {memberIds.map((uid) => {
            const m = memberOptions.find((mo) => mo.userId === uid);
            return (
              <Chip
                key={uid}
                label={m?.name ?? "Member"}
                onRemove={() =>
                  setMemberIds((prev) => prev.filter((x) => x !== uid))
                }
              />
            );
          })}
          {guestEmails.map((email) => (
            <Chip
              key={email}
              label={email}
              onRemove={() =>
                setGuestEmails((prev) => prev.filter((e) => e !== email))
              }
            />
          ))}
        </div>
      )}
      <div className="flex items-center justify-end gap-1.5 mt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={totalQueued === 0 || submitting}
          onClick={() => void handleSubmit()}
        >
          <UserPlus className="h-3.5 w-3.5 mr-1" />
          {totalQueued === 0
            ? "Add"
            : `Add ${totalQueued} ${totalQueued === 1 ? "person" : "people"}`}
        </Button>
      </div>
    </div>
  );
}

// Inline pill chip — same shape as CreateEventDialog's, kept local so the
// sheet doesn't carry an indirect dependency on that file.
function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted text-foreground text-xs px-2 py-0.5">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground"
        aria-label={`Remove ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// EditableDateTime — date + start + end inline triple.
//
// Visual: a single row. Three popover triggers (date, start, end) sit
// inline; clicking any one opens the same picker the create dialog uses,
// so create vs. edit feel identical. Saving fires only when the user
// changes a value — popover dismissals without a change are no-ops.
// ───────────────────────────────────────────────────────────────────────────

function EditableDateTime({
  startsAt,
  endsAt,
  onSave,
}: {
  startsAt: number;
  endsAt: number;
  onSave: (startsAt: number, endsAt: number) => void | Promise<void>;
}) {
  // Decompose ms into (date, time) pairs in local tz. We use exact-time
  // (not 15-min quantised) so a 10:42 event round-trips losslessly.
  const startDate = useMemo(() => {
    const d = new Date(startsAt);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [startsAt]);
  const startTime = useMemo(() => msToExactTime(startsAt), [startsAt]);
  const endTime = useMemo(() => msToExactTime(endsAt), [endsAt]);
  // "+1 day" pill: when the wall-clock end ≤ start, the create form
  // models that as a midnight crossing. We mirror the same hint here.
  const spansMidnight = endTime <= startTime;

  const commit = (next: { date: Date; startTime: string; endTime: string }) => {
    const nextStart = combineDateAndTime(next.date, next.startTime).getTime();
    let nextEnd = combineDateAndTime(next.date, next.endTime).getTime();
    if (nextEnd <= nextStart) nextEnd += ONE_DAY_MS;
    if (nextStart === startsAt && nextEnd === endsAt) return; // no-op
    void onSave(nextStart, nextEnd);
  };

  return (
    <section>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          When
        </p>
        {spansMidnight && (
          <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground bg-muted rounded px-1 py-0.5 ml-1">
            +1 day
          </span>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-1.5 items-center">
        <DatePopover
          value={startDate}
          onChange={(d) => commit({ date: d, startTime, endTime })}
          triggerClassName="h-9"
        />
        <TimeSelect
          value={startTime}
          onChange={(t) => commit({ date: startDate, startTime: t, endTime })}
          triggerClassName="h-9 w-24"
        />
        <TimeSelect
          value={endTime}
          startTime={startTime}
          onChange={(t) => commit({ date: startDate, startTime, endTime: t })}
          triggerClassName="h-9 w-24"
        />
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// EditableChannel — channel picker inline. Treats null/empty as "unlink".
// ───────────────────────────────────────────────────────────────────────────

function EditableChannel({
  value,
  channels,
  onSave,
}: {
  value: string;
  channels: { _id: Id<"channels">; name: string }[];
  onSave: (next: string) => void | Promise<void>;
}) {
  return (
    <section>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Hash className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Channel
        </p>
      </div>
      <ChannelCombobox
        channels={channels}
        value={value}
        onChange={(next) => {
          if (next === value) return;
          void onSave(next);
        }}
        triggerClassName="h-9"
      />
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// EditableDescription — multi-line, click to edit. Saves on blur.
// ───────────────────────────────────────────────────────────────────────────

function EditableDescription({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void | Promise<void>;
}) {
  // Same pattern as EditableTitle: `null` draft = read mode, string draft =
  // edit mode. Avoids the prop→state sync effect.
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  const startEditing = () => setDraft(value);

  const commit = () => {
    if (draft === null) return;
    const next = draft;
    setDraft(null);
    if (next === value) return;
    void onSave(next);
  };

  const cancel = () => setDraft(null);

  return (
    <section>
      <div className="flex items-center gap-1.5 mb-1.5">
        <AlignLeft className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Description
        </p>
      </div>
      {editing ? (
        <Textarea
          value={draft ?? ""}
          autoFocus
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
            // Cmd/Ctrl+Enter saves, Esc reverts. Plain Enter inserts a
            // newline as expected for a multi-line field.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          placeholder="Agenda, links, …"
          className="text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className="group w-full text-left -mx-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors flex items-start gap-2"
        >
          <span
            className={cn(
              "text-sm whitespace-pre-wrap min-w-0 flex-1",
              !value && "text-muted-foreground italic",
            )}
          >
            {value || "Add a description"}
          </span>
          <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
        </button>
      )}
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Read-only sub-components
// ───────────────────────────────────────────────────────────────────────────

function ReadDateTime({ startsAt, endsAt }: { startsAt: number; endsAt: number }) {
  return (
    <ReadSection icon={<Clock className="h-3.5 w-3.5" />} label="When">
      <p className="text-sm">{formatRange(startsAt, endsAt)}</p>
    </ReadSection>
  );
}

function ReadSection({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
      </div>
      {children}
    </section>
  );
}

function PersonRow({
  name,
  image,
  guest,
  subtitle,
}: {
  name: string;
  image?: string;
  guest?: boolean;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Avatar className="size-6">
        {image && <AvatarImage src={image} alt={name} />}
        <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex flex-col">
        <span className="text-sm truncate">
          {name}
          {guest && (
            <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              guest
            </span>
          )}
        </span>
        {subtitle && (
          <span className="text-xs text-muted-foreground truncate">{subtitle}</span>
        )}
      </div>
    </div>
  );
}

function formatRange(startsAt: number, endsAt: number): string {
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
