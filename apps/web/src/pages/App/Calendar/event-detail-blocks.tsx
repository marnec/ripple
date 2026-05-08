/**
 * Shared editable building blocks for the event detail surfaces — both
 * `EventDetailSheet` (desktop side panel) and `EventDetailPage` (mobile
 * + desktop full page) compose them. Putting them here keeps the two
 * shells thin: each owns only the chrome (back button, sheet vs page
 * layout, post-destroy navigation) and delegates content rendering to
 * the same leaves, so editing on the page or in the sheet feels
 * identical at the field level.
 *
 * Aesthetic notes:
 *   • Read state: bare text with section labels above. The faint
 *     `hover:bg-muted/40` lift on editable rows is the only chrome — no
 *     borders, no field backgrounds. Affordance comes from a pencil
 *     icon that fades in on row hover.
 *   • Edit state: the row morphs into a popover trigger / input. A
 *     subtle ring marks focus without shouting.
 *   • Editing is gated to organisers on non-cancelled events.
 */

import {
  type KeyboardEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlignLeft,
  Clock,
  Hash,
  Pencil,
  UserPlus,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { InviteeMultiSelect } from "@/components/InviteeMultiSelect";

import type { Id } from "@convex/_generated/dataModel";
import { parseEmailChips } from "../Dashboard/dashboard-calendar-utils";
import { Chip } from "./Chip";
import { ChannelCombobox, DatePopover, TimeSelect } from "./event-fields";
import { combineDateAndTime, msToExactTime } from "./event-time-utils";
import { ONE_DAY_MS, formatRange } from "./event-detail-data";

// ───────────────────────────────────────────────────────────────────────────
// EditableTitle — click-to-edit single-line title.
//
// Variants: `size="md"` for the sheet (matches SheetTitle's text-base) and
// `size="lg"` for the full page (text-2xl). Avoids forking the component
// so the morph behaviour stays in one place.
// ───────────────────────────────────────────────────────────────────────────

export function EditableTitle({
  value,
  onSave,
  size = "md",
  TitleSlot,
}: {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  size?: "md" | "lg";
  /** Optional render-prop for the read-mode title element. The sheet
   *  passes SheetTitle so Radix's a11y labelling works; the page can
   *  pass a plain `<h1>`. */
  TitleSlot?: React.ComponentType<{ className?: string; children: React.ReactNode }>;
}) {
  // `null` draft = read mode, string = in-flight edit. Avoids a
  // sync-from-prop effect (which lints fail under react-hooks/set-state-in-effect).
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = draft !== null;

  const startEditing = () => setDraft(value);

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next === "" || next === value.trim()) return;
    void onSave(next);
  };

  const cancel = () => setDraft(null);

  const titleClass =
    size === "lg"
      ? "text-2xl font-semibold tracking-tight truncate"
      : "text-base font-semibold truncate";
  const inputClass =
    size === "lg" ? "h-10 px-2 text-2xl font-semibold tracking-tight" : "h-7 px-1.5 text-base font-semibold";

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
        className={inputClass}
      />
    );
  }

  const Title = TitleSlot ?? "h2";
  return (
    <button
      type="button"
      onClick={startEditing}
      className="group flex items-center gap-1.5 text-left min-w-0 -mx-1.5 px-1.5 py-0.5 rounded-md hover:bg-muted/50 transition-colors"
    >
      <Title className={titleClass}>{value}</Title>
      <Pencil
        className={cn(
          "text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0",
          size === "lg" ? "h-4 w-4" : "h-3 w-3",
        )}
      />
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// EditableDateTime — date + start + end inline triple.
// ───────────────────────────────────────────────────────────────────────────

export function EditableDateTime({
  startsAt,
  endsAt,
  onSave,
}: {
  startsAt: number;
  endsAt: number;
  onSave: (startsAt: number, endsAt: number) => void | Promise<void>;
}) {
  const startDate = useMemo(() => {
    const d = new Date(startsAt);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [startsAt]);
  const startTime = useMemo(() => msToExactTime(startsAt), [startsAt]);
  const endTime = useMemo(() => msToExactTime(endsAt), [endsAt]);
  const spansMidnight = endTime <= startTime;

  const commit = (next: { date: Date; startTime: string; endTime: string }) => {
    const nextStart = combineDateAndTime(next.date, next.startTime).getTime();
    let nextEnd = combineDateAndTime(next.date, next.endTime).getTime();
    if (nextEnd <= nextStart) nextEnd += ONE_DAY_MS;
    if (nextStart === startsAt && nextEnd === endsAt) return;
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
// EditableChannel — picks the channel whose persistent meeting room hosts
// this event's call. Optional; null/empty means "give this event its own
// one-time room". DM channels are excluded by the parent (see
// useEventDetail). The label is "Hosted in" rather than "Channel" to make
// clear that the channel is a venue, not an access boundary — event access
// is always invitee-based.
// ───────────────────────────────────────────────────────────────────────────

export function EditableChannel({
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
          Hosted in
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
// EditableDescription — multi-line, click to edit. Cmd/Ctrl+Enter saves.
// ───────────────────────────────────────────────────────────────────────────

export function EditableDescription({
  value,
  onSave,
  rows = 3,
}: {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  /** Page surface uses 6 rows for a roomier compose box. */
  rows?: number;
}) {
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
          rows={rows}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
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
// InviteAdder — add-invitees affordance with a collapse/expand cycle.
// ───────────────────────────────────────────────────────────────────────────

export function InviteAdder({
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

// ───────────────────────────────────────────────────────────────────────────
// Read-only helpers (used by both surfaces)
// ───────────────────────────────────────────────────────────────────────────

export function ReadDateTime({
  startsAt,
  endsAt,
}: {
  startsAt: number;
  endsAt: number;
}) {
  return (
    <ReadSection icon={<Clock className="h-3.5 w-3.5" />} label="When">
      <p className="text-sm">{formatRange(startsAt, endsAt)}</p>
    </ReadSection>
  );
}

export function ReadSection({
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

export function PersonRow({
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

