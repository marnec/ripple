import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useEffect } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { cn } from "@/lib/utils";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { parseEmailChips } from "../Dashboard/dashboard-calendar-utils";
import { InviteeMultiSelect } from "@/components/InviteeMultiSelect";
import {
  ChannelCombobox,
  DatePopover,
  TimeSelect,
} from "./event-fields";
import {
  TIME_RE,
  addMinutes,
  combineDateAndTime,
  msToTimeSlot,
  timeToMinutes,
} from "./event-time-utils";

const ONE_HOUR_MS = 60 * 60 * 1000;
const SLOT_MS = 15 * 60 * 1000;

// Google-Calendar style: pick a single date, then a start time and an end
// time. If the end time is ≤ start time, the event is treated as crossing
// midnight (end on the next day) — the only multi-day case allowed.
const formSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200),
    description: z.string().max(4000).optional(),
    date: z.date({ message: "Pick a date" }),
    startTime: z.string().regex(TIME_RE, "Required"),
    endTime: z.string().regex(TIME_RE, "Required"),
    channelId: z.string().optional(),
  })
  .refine(
    (v) =>
      // Forbid the degenerate case where times are identical AND on the
      // same day — that's a 0-duration event. All other shapes (including
      // end < start which spans midnight) are valid by construction.
      !(v.startTime === v.endTime),
    {
      message: "Start and end times can't be identical",
      path: ["endTime"],
    },
  );

type FormValues = z.infer<typeof formSchema>;

/**
 * Round a Date up to the next 15-min boundary. Used to seed defaults so
 * the start lands on a valid TimeSelect option whether the source is
 * `Date.now() + 1h` (button create) or a user-clicked time-grid slot.
 */
function roundUpToSlot(d: Date): Date {
  return new Date(Math.ceil(d.getTime() / SLOT_MS) * SLOT_MS);
}

function midnightOf(d: Date): Date {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return day;
}

export type CreateEventFormProps = {
  workspaceId: Id<"workspaces">;
  /** Pre-fills the start time. Defaults to now + 1h rounded to the next
   *  15-min slot when omitted. */
  initialDate?: Date;
  /** Pre-fills the end time. Defaults to start + 1h when omitted. */
  initialEndDate?: Date;
  /** Workspace members to pre-select in the invitee picker. Used by the
   *  dashboard's "view colleague calendar" overlay so a created event
   *  auto-invites the people the viewer was looking at. The user can
   *  deselect any of them before submitting. Empty/undefined ⇒ no
   *  invitees seeded (the default for the global "+ New event" CTA). */
  initialMemberIds?: Id<"users">[];
  /** Called after the create mutation succeeds (used to dismiss the
   *  surface — dialog or popover — that mounted this form). */
  onSuccess: () => void;
  /** Called when the user clicks the Cancel button. */
  onCancel: () => void;
  /** Called whenever the start/end time fields change so an external
   *  surface (e.g. a "ghost event" overlay) can mirror the live values.
   *  Fires with concrete `Date`s on the form's selected day; if the end
   *  ≤ start (midnight crossover) the end Date is pushed one day
   *  forward to match what the create mutation will persist. */
  onTimesChange?: (start: Date, end: Date) => void;
  /** Layout density. "popover" tightens spacing and drops the
   *  description/invitees fields to fit a side-anchored popover. */
  density?: "default" | "compact";
  className?: string;
};

/**
 * The shared event-creation form, surface-agnostic. Used by:
 *   - `CreateEventDialog` for the global "+ New event" affordance.
 *   - `InlineEventCreator` for the click/drag-to-create flow on the
 *     calendar's time grid (rendered inside a Popover anchored to a
 *     ghost event).
 *
 * Defaults are read once from `initialDate` / `initialEndDate` via lazy
 * `useState`. Re-seeding for re-opens is the parent's responsibility —
 * the dialog passes a `key` derived from each false→true open
 * transition, and the inline creator mounts a fresh instance per drag.
 * Keeping reset logic out of this component avoids the open-vs-prop
 * coordination dance the previous monolithic dialog had.
 */
export function CreateEventForm({
  workspaceId,
  initialDate,
  initialEndDate,
  initialMemberIds,
  onSuccess,
  onCancel,
  onTimesChange,
  density = "default",
  className,
}: CreateEventFormProps) {
  const create = useMutation(api.calendarEvents.create);
  const channels = useQuery(api.channels.list, { workspaceId });
  const members = useQuery(api.workspaceMembers.membersWithRoles, { workspaceId });

  // Local invitees state — kept outside RHF because the chip widget owns
  // its own UI. We submit them alongside the form values. The lazy
  // initializer reads `initialMemberIds` exactly once on mount so a
  // re-render with a different parent prop doesn't blow away whatever
  // the user has since deselected.
  const [memberIds, setMemberIds] = useState<Id<"users">[]>(
    () => initialMemberIds ?? [],
  );
  const [guestEmails, setGuestEmails] = useState<string[]>([]);
  const [invalidEmail, setInvalidEmail] = useState<string | null>(null);

  // Seed defaults exactly once at mount. The clock read for the
  // "no initialDate" fallback also stays at mount time so React
  // Compiler / strict-rules don't see Date.now() at render time.
  const [defaults] = useState(() => {
    const startSeed = initialDate ?? new Date(Date.now() + ONE_HOUR_MS);
    const start = roundUpToSlot(startSeed);
    const endSeed = initialEndDate ?? new Date(start.getTime() + ONE_HOUR_MS);
    // The end snaps to a slot too — drag selections rarely land on a
    // 15-min boundary by themselves, so this matches the Time picker's
    // available options regardless of where the user released.
    const end = roundUpToSlot(endSeed);
    return {
      date: midnightOf(start),
      startTime: msToTimeSlot(start.getTime()),
      endTime: msToTimeSlot(end.getTime()),
      // Track whether the seeded end was user-supplied (drag) so the
      // start-change auto-bump treats it as "touched" and preserves
      // the duration the user already selected.
      endTouchedInitially: initialEndDate !== undefined,
    };
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      date: defaults.date,
      startTime: defaults.startTime,
      endTime: defaults.endTime,
      channelId: "",
    },
  });

  // Live-watch the start/end times so the "next day" hint and duration
  // labels in the dropdown can react before submit. `useWatch` is safe
  // during render; `form.watch()` is not (React Compiler skips
  // memoisation, see feedback_rhf_react_compiler.md).
  const watchedStart = useWatch({ control: form.control, name: "startTime" });
  const watchedEnd = useWatch({ control: form.control, name: "endTime" });
  const watchedDate = useWatch({ control: form.control, name: "date" });
  const spansMidnight = !!watchedStart && !!watchedEnd && watchedEnd <= watchedStart;

  // Mirror live form values to the parent so a ghost overlay can stay
  // in sync as the user nudges the time pickers. We skip the very
  // first effect run — the initial values came from the parent itself
  // (via `initialDate`/`initialEndDate`) so re-emitting them is just
  // noise. After that, every form-driven change propagates.
  useEffect(() => {
    if (!onTimesChange) return;
    if (
      !watchedDate ||
      !TIME_RE.test(watchedStart) ||
      !TIME_RE.test(watchedEnd)
    ) {
      return;
    }
    const start = combineDateAndTime(watchedDate, watchedStart);
    let end = combineDateAndTime(watchedDate, watchedEnd);
    // Mirror the persistence rule: end ≤ start ⇒ +1 day.
    if (end.getTime() <= start.getTime()) {
      end = new Date(end.getTime() + 24 * ONE_HOUR_MS);
    }
    onTimesChange(start, end);
  }, [watchedDate, watchedStart, watchedEnd, onTimesChange]);

  // End-time auto-bump: when the user shifts the start, slide the end
  // with it so the duration is preserved. While the end is still
  // pristine (untouched since the seeded defaults), the bump locks the
  // duration to exactly 60 min — that re-pegs the end if the user picks
  // a start far from the seeded one without ever interacting with the
  // end picker. The moment the user opens the end picker we flip
  // `endTouched` to true and switch to delta-preservation, matching
  // Google Calendar's behaviour.
  //
  // Stored as React state rather than a ref because the React Compiler
  // immutability rule forbids mutating a `useRef.current` from both an
  // effect and an event handler; state writes go through the React
  // scheduler so all sites are uniformly tracked.
  const [endTouched, setEndTouched] = useState(defaults.endTouchedInitially);

  const handleStartChange = (newStart: string) => {
    // Read current values BEFORE the form update propagates so the
    // delta is computed against the previous start, not the new one.
    const prevStart = form.getValues("startTime");
    const prevEnd = form.getValues("endTime");
    form.setValue("startTime", newStart, { shouldValidate: true });

    if (!endTouched) {
      // Pristine end — relock to start + 1h.
      form.setValue("endTime", addMinutes(newStart, 60), { shouldValidate: true });
      return;
    }
    // Touched end — preserve the user-set duration, including the
    // cross-midnight case (negative same-day delta). `addMinutes` wraps
    // at 24h so the wrapped end correctly signals "+1 day" downstream.
    const prevDelta = TIME_RE.test(prevStart) && TIME_RE.test(prevEnd)
      ? (timeToMinutes(prevEnd) - timeToMinutes(prevStart) + 24 * 60) % (24 * 60)
      : 60;
    form.setValue("endTime", addMinutes(newStart, prevDelta || 60), {
      shouldValidate: true,
    });
  };

  const handleEndChange = (newEnd: string) => {
    setEndTouched(true);
    form.setValue("endTime", newEnd, { shouldValidate: true });
  };

  const handleSubmit = async (values: FormValues) => {
    try {
      const startsAt = combineDateAndTime(values.date, values.startTime).getTime();
      let endsAt = combineDateAndTime(values.date, values.endTime).getTime();
      // The only allowed multi-day shape: end ≤ start ⇒ event crosses
      // midnight, so push the end one calendar day forward.
      if (endsAt <= startsAt) endsAt += 24 * ONE_HOUR_MS;

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      await create({
        workspaceId,
        title: values.title,
        description: values.description || undefined,
        startsAt,
        endsAt,
        timezone: tz,
        channelId:
          values.channelId && values.channelId !== ""
            ? (values.channelId as Id<"channels">)
            : undefined,
        invitees: { userIds: memberIds, guestEmails },
      });
      toast.success("Event created");
      onSuccess();
    } catch (e) {
      toast.error("Could not create event", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleAddEmail = (raw: string) => {
    const { valid, invalid } = parseEmailChips(raw);
    if (invalid.length > 0) {
      setInvalidEmail(invalid[0] ?? null);
    } else {
      setInvalidEmail(null);
    }
    if (valid.length > 0) {
      setGuestEmails((prev) => Array.from(new Set([...prev, ...valid])));
    }
  };

  // Member options exclude the organiser (they're implicitly attending).
  const memberOptions =
    members?.map((m) => ({
      userId: m.userId,
      name: m.name ?? m.email ?? "Unknown",
      email: m.email,
      image: m.image,
    })) ?? [];

  const compact = density === "compact";

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit(handleSubmit)(e);
        }}
        className={cn("flex flex-col", className)}
      >
        <div className={cn(compact ? "space-y-3" : "space-y-4")}>
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input placeholder="Weekly sync" autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Google-Calendar-style date + time row: one date picker
              feeds both the start and end clocks. If end ≤ start the
              event is treated as spanning midnight; we surface a
              "next day" pill so the user knows.
              In compact (popover) layout we keep the row vertical so
              the popover stays narrow enough for a 320 px sidebar. */}
          <div
            className={cn(
              "flex gap-3 items-stretch",
              compact
                ? "flex-col"
                : "flex-col sm:flex-row sm:items-end",
            )}
          >
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                // min-w-0 is mandatory on flex children whose content
                // can exceed the column width — without it, flex-basis
                // defaults to `auto` and the row blows past its parent.
                <FormItem
                  className={cn(
                    "flex flex-col min-w-0",
                    compact ? undefined : "sm:flex-1",
                  )}
                >
                  <FormLabel>Date</FormLabel>
                  <DatePopover
                    value={field.value}
                    onChange={(d) => field.onChange(d)}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className={cn("flex gap-3", compact ? "flex-row" : "contents")}>
              <FormField
                control={form.control}
                name="startTime"
                render={({ field }) => (
                  <FormItem
                    className={cn(
                      "flex flex-col min-w-0",
                      compact ? "flex-1" : "sm:w-28 sm:shrink-0",
                    )}
                  >
                    <FormLabel>Start</FormLabel>
                    <TimeSelect value={field.value} onChange={handleStartChange} />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endTime"
                render={({ field }) => (
                  <FormItem
                    className={cn(
                      "flex flex-col min-w-0",
                      compact ? "flex-1" : "sm:w-28 sm:shrink-0",
                    )}
                  >
                    <FormLabel className="flex items-center gap-1.5">
                      <span>End</span>
                      {spansMidnight && (
                        <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground bg-muted rounded px-1 py-0.5">
                          +1 day
                        </span>
                      )}
                    </FormLabel>
                    <TimeSelect
                      value={field.value}
                      onChange={handleEndChange}
                      startTime={watchedStart}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <FormField
            control={form.control}
            name="channelId"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Channel (optional)</FormLabel>
                <ChannelCombobox
                  channels={channels ?? []}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                />
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Description and Invitees are hidden in compact mode — the
              popover surface anchors next to a tiny ghost event and
              can't accommodate the full multiselect comfortably. Users
              who need those fields can hit "More options" (added by
              CreateEventDialog) or edit the event after creation. */}
          {!compact && (
            <>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Agenda, links, …" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <FormLabel>Invitees</FormLabel>
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
                          setGuestEmails((prev) =>
                            prev.filter((e) => e !== email),
                          )
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Compact (popover) mode hides the full invitee picker, but
              if the parent seeded members via `initialMemberIds` we
              still surface a short summary so the user knows the event
              will go out with invitees attached. They can pop the full
              dialog (or edit post-create) for fine-grained control. */}
          {compact && memberIds.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Inviting {memberIds.length} member
              {memberIds.length === 1 ? "" : "s"} from your filter
            </p>
          )}
        </div>

        <div
          className={cn(
            "flex justify-end gap-2",
            compact ? "mt-3" : "mt-5",
          )}
        >
          <Button type="button" variant="outline" size={compact ? "sm" : "default"} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size={compact ? "sm" : "default"} disabled={form.formState.isSubmitting}>
            Create event
          </Button>
        </div>
      </form>
    </Form>
  );
}

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
