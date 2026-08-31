/**
 * The invitee roster: who is invited, what they answered, and (for whoever
 * may edit it) the controls to add and remove people.
 *
 * It takes a plain list of rows and a handful of callbacks rather than a
 * query result, because two different tables hold rosters —
 * `calendarEventInvitees` for a one-off event and `eventSeriesInvitees`
 * for a repeating one. Those rows differ only in what they point at; every
 * field this UI reads (who it is, member or guest, what they answered) is
 * common to both, so `RosterInvitee` describes what is already there
 * rather than inventing a shape to convert into. A surface backed by
 * either table hands its rows straight over.
 *
 * The invitee id stays generic so `onRemove` receives the caller's own
 * `Id<…>` and not a bare string — the roster never looks at the value, it
 * only keys rows by it and hands it back.
 */

import { useState } from "react";
import { MailWarning, Trash2, UserPlus } from "lucide-react";

import { Button } from "@ripple/ui/components/button";
import { InviteeMultiSelect } from "@/components/InviteeMultiSelect";
import { cn } from "@/lib/utils";
import { inviteDeliveryNotice } from "@ripple/shared/inviteDelivery";

import type { Id } from "@convex/_generated/dataModel";
import { parseEmailChips } from "../Dashboard/dashboard-calendar-utils";
import { Chip } from "./Chip";
import { PersonRow } from "./event-detail-blocks";
import { RSVP_BADGE_CLASS, RSVP_LABEL } from "./event-detail-data";

/** One row of a roster, as either invitee table stores it (plus the user
 *  fields the read query denormalises onto member rows). */
export type RosterInvitee<TInviteeId extends string = string> = {
  _id: TInviteeId;
  userId?: Id<"users">;
  userName?: string;
  userEmail?: string;
  userImage?: string;
  guestEmail?: string;
  guestName?: string;
  status: "pending" | "accepted" | "tentative" | "declined";
  /** Absent on rosters whose table does not track email delivery. */
  deliveryStatus?: string;
  deliveryError?: string;
};

/** A workspace member the adder may offer. */
export type RosterCandidate = {
  userId: Id<"users">;
  name?: string;
  email?: string;
  image?: string;
};

export function InviteeRoster<TInviteeId extends string>({
  invitees,
  editable,
  members,
  organizerId,
  onAdd,
  onRemove,
  onSelfInvite,
}: {
  invitees: readonly RosterInvitee<TInviteeId>[];
  /** Whether the viewer may change the roster. Gates every control on it:
   *  the remove buttons, the adder, and the self-invite row. */
  editable: boolean;
  /** Workspace members the adder may offer. Those already on the roster,
   *  and the organizer, are filtered out of it. */
  members: RosterCandidate[] | undefined;
  organizerId: Id<"users">;
  onAdd: (
    userIds: Id<"users">[],
    guestEmails: string[],
  ) => void | Promise<void>;
  onRemove: (inviteeId: TInviteeId) => void | Promise<void>;
  /** Ghost CTA at the top of the list. Passing it says this resource offers
   *  a self-invite *and* the viewer is not on the roster yet — keeps
   *  organizer↔resource out of the knowledge graph by default while making
   *  opting in a single click. Omit it and the row is not rendered, which
   *  is what a roster with no self-invite of its own does. */
  onSelfInvite?: () => void | Promise<void>;
}) {
  const existingUserIds = new Set(
    invitees.map((i) => i.userId).filter((id): id is Id<"users"> => !!id),
  );
  const existingGuestEmails = new Set(
    invitees.map((i) => i.guestEmail).filter((e): e is string => !!e),
  );

  const showSelfInvite = editable && !!onSelfInvite;

  return (
    <section>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Invitees
        </p>
        <span className="text-xs text-muted-foreground tabular-nums">
          {invitees.length}
        </span>
      </div>
      {invitees.length === 0 && !showSelfInvite ? (
        <p className="text-xs text-muted-foreground">No one invited yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {showSelfInvite && (
            <li>
              <button
                type="button"
                onClick={() => void onSelfInvite()}
                className="w-full flex items-center gap-2 text-sm rounded-md border border-dashed border-muted-foreground/30 px-2 py-1.5 text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted/40 transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Add yourself as invitee</span>
              </button>
            </li>
          )}
          {invitees.map((inv) => {
            const delivery = inviteDeliveryNotice(inv);
            return (
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
                {/* Only failures are shown, and only as an icon: an invitee whose
                    mail is merely in flight is not news, and "pending" is
                    ambiguous precisely when delivery went wrong. The reason rides
                    in the tooltip so the row stays one line. */}
                {delivery && (
                  <span
                    className={cn(
                      "ml-auto shrink-0",
                      delivery.tone === "error"
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                    title={
                      delivery.detail
                        ? `${delivery.label} · ${delivery.detail}`
                        : delivery.label
                    }
                    aria-label={delivery.label}
                  >
                    <MailWarning className="h-3.5 w-3.5" />
                  </span>
                )}
                <span
                  className={cn(
                    "text-[11px] px-1.5 py-0.5 rounded font-medium",
                    delivery ? "" : "ml-auto",
                    RSVP_BADGE_CLASS[inv.status],
                  )}
                >
                  {RSVP_LABEL[inv.status]}
                </span>
                {editable && (
                  <button
                    type="button"
                    onClick={() => void onRemove(inv._id)}
                    aria-label={`Remove ${inv.userName ?? inv.guestEmail ?? "invitee"}`}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editable && (
        <InviteAdder
          members={members ?? []}
          existingUserIds={existingUserIds}
          existingGuestEmails={existingGuestEmails}
          organizerId={organizerId}
          onSubmit={onAdd}
        />
      )}
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// InviteAdder — add-invitees affordance with a collapse/expand cycle.
//
// Private to the roster: an adder is only ever the tail of a list, and the
// two are wired to the same resource by construction when nobody outside
// can mount one without the other.
// ───────────────────────────────────────────────────────────────────────────

function InviteAdder({
  members,
  existingUserIds,
  existingGuestEmails,
  organizerId,
  onSubmit,
}: {
  members: RosterCandidate[] | undefined;
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

  const memberOptions = (members ?? [])
    .filter((m) => m.userId !== organizerId && !existingUserIds.has(m.userId))
    .map((m) => ({
      userId: m.userId,
      name: m.name ?? m.email ?? "Unknown",
      email: m.email,
      image: m.image,
    }));

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
