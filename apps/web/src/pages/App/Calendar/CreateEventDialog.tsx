import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { CalendarIcon, Check, ChevronsUpDown, Hash, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { parseEmailChips } from "../Dashboard/dashboard-calendar-utils";
import { InviteeMultiSelect } from "@/components/InviteeMultiSelect";

const ONE_HOUR_MS = 60 * 60 * 1000;
const TIME_RE = /^\d{2}:\d{2}$/;

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

/** "00:00" … "23:45" in 15-minute increments — Google-Calendar default. */
const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

/** Quantise an ms timestamp's wall-clock time to the nearest 15-min slot
 *  (rounding down) and return as "HH:mm". */
function msToTimeSlot(ms: number): string {
  const d = new Date(ms);
  const minutes = Math.floor(d.getMinutes() / 15) * 15;
  return `${String(d.getHours()).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Combine a wall-clock date + "HH:mm" time into a local-tz Date. */
function combineDateAndTime(date: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const out = new Date(date);
  out.setHours(h ?? 0, m ?? 0, 0, 0);
  return out;
}

/** Pretty-print a "HH:mm" using the user's locale (12h/24h follows the OS). */
function formatTimeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function CreateEventDialog({
  workspaceId,
  open,
  onOpenChange,
  initialDate,
}: {
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate?: Date;
}) {
  const create = useMutation(api.calendarEvents.create);
  const channels = useQuery(api.channels.list, { workspaceId });
  const members = useQuery(api.workspaceMembers.membersWithRoles, { workspaceId });

  // Local invitees state — kept outside RHF because the chip widget owns its
  // own UI. We submit them alongside the form values.
  const [memberIds, setMemberIds] = useState<Id<"users">[]>([]);
  const [guestEmails, setGuestEmails] = useState<string[]>([]);
  const [invalidEmail, setInvalidEmail] = useState<string | null>(null);

  // Lazy init: read the clock exactly once when the dialog mounts so React
  // Compiler / strict-rules don't see Date.now() at render time. The user
  // will rarely keep the dialog open across multiple minutes anyway. The
  // default start rounds up to the next 15-min boundary (Google-style),
  // and the default end is +1h.
  const [defaults] = useState(() => {
    const seed = (initialDate ?? new Date(Date.now() + ONE_HOUR_MS)).getTime();
    // Round to next 15-min boundary so the default sits on a valid slot.
    const slotMs = 15 * 60 * 1000;
    const startMs = Math.ceil(seed / slotMs) * slotMs;
    const endMs = startMs + ONE_HOUR_MS;
    const startDate = new Date(startMs);
    const day = new Date(startDate);
    day.setHours(0, 0, 0, 0);
    return {
      date: day,
      startTime: msToTimeSlot(startMs),
      endTime: msToTimeSlot(endMs),
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
  const spansMidnight = !!watchedStart && !!watchedEnd && watchedEnd <= watchedStart;

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
      form.reset();
      setMemberIds([]);
      setGuestEmails([]);
      onOpenChange(false);
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

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} direction="top">
      {/* Override the Dialog's default sm:max-w-sm — the date + two time
          pills + invitee inputs need ~32rem to lay out without overflow. */}
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>New event</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Schedule a call and invite people. Guests can join via email
            invitation; workspace members get an in-app notification.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit(handleSubmit)(e);
            }}
          >
            <ResponsiveDialogBody className="space-y-4 mb-2">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Weekly sync" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Google-Calendar-style date + time row: one date picker
                  feeds both the start and end clocks. If end ≤ start the
                  event is treated as spanning midnight; we surface a
                  "next day" pill so the user knows. */}
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    // min-w-0 is mandatory on flex children whose content
                    // can exceed the column width — without it, flex-basis
                    // defaults to `auto` and the row blows past its parent.
                    <FormItem className="flex flex-col sm:flex-1 min-w-0">
                      <FormLabel>Date</FormLabel>
                      <DatePopover
                        value={field.value}
                        onChange={(d) => field.onChange(d)}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="startTime"
                  render={({ field }) => (
                    <FormItem className="flex flex-col min-w-0 sm:w-28 sm:shrink-0">
                      <FormLabel>Start</FormLabel>
                      <TimeSelect value={field.value} onChange={field.onChange} />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endTime"
                  render={({ field }) => (
                    <FormItem className="flex flex-col min-w-0 sm:w-28 sm:shrink-0">
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
                        onChange={field.onChange}
                        startTime={watchedStart}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Create event
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
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

// ───────────────────────────────────────────────────────────────────────
// DatePopover — shadcn `Calendar` in a Popover. Mirrors the trigger-button
// look of DatePickerField but accepts/returns a Date object directly,
// since the form schema uses Date (no ISO string round-trip needed).
// ───────────────────────────────────────────────────────────────────────

function DatePopover({
  value,
  onChange,
}: {
  value: Date | undefined;
  onChange: (d: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  // The wrapper <div> is load-bearing: base-ui's PopoverPortal renders
  // FloatingPortal which inserts two FocusGuard <span>s (and one
  // visually-hidden aria-owns <span>) inline at the popover's position
  // in the React tree. Without this wrapper they become siblings of the
  // trigger inside the parent FormItem. FormItem's `space-y-2` then
  // matches the trigger via `:not(:last-child)` and adds 8px of
  // margin-block-end → the dialog (position:fixed top:50%
  // translate-y:-50%) re-centers, shifting the form up by ~4px on every
  // popover open. The wrapper absorbs those siblings so the FormItem's
  // direct-children layout stays stable.
  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              className={cn(
                "w-full min-w-0 justify-start text-left font-normal",
                !value && "text-muted-foreground",
              )}
              type="button"
            />
          }
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value
            ? value.toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "Pick a date"}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => {
              if (!d) return;
              onChange(d);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// TimeSelect — Popover + Command listing 15-min increments.
//
// Behaviour mirrors Google Calendar's end-time dropdown:
//   • If `startTime` is provided (i.e. this is the *end* picker) and the
//     candidate slot lands AFTER start on the same day, we annotate it
//     with a duration label ("15 min", "1 hr"). Slots earlier than the
//     start time are still selectable — they signal a midnight crossing,
//     which the parent surfaces with a "+1 day" pill.
//   • The currently-selected slot scrolls into view on open so the user
//     doesn't have to scroll to find their place in a 96-row list.
// ───────────────────────────────────────────────────────────────────────

function TimeSelect({
  value,
  onChange,
  startTime,
}: {
  value: string;
  onChange: (v: string) => void;
  startTime?: string;
}) {
  const [open, setOpen] = useState(false);
  // Wrapper rationale documented in DatePopover above — same FocusGuard
  // siblings + space-y-2 interaction.
  return (
    <div>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className="w-full justify-between font-normal"
            type="button"
          />
        }
      >
        <span>{value ? formatTimeLabel(value) : "Select time"}</span>
        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="p-0 w-44" align="start">
        <Command>
          <CommandInput placeholder="Search time…" />
          <CommandList className="max-h-64">
            <CommandEmpty>No times.</CommandEmpty>
            <CommandGroup>
              {TIME_OPTIONS.map((slot) => {
                const selected = slot === value;
                const duration =
                  startTime && slot > startTime ? sameDayDuration(startTime, slot) : null;
                return (
                  <CommandItem
                    key={slot}
                    value={slot}
                    onSelect={() => {
                      onChange(slot);
                      setOpen(false);
                    }}
                    className="cursor-pointer"
                  >
                    <span className="flex-1">{formatTimeLabel(slot)}</span>
                    {duration && (
                      <span className="ml-2 text-xs text-muted-foreground">{duration}</span>
                    )}
                    <Check
                      className={cn(
                        "ml-2 h-4 w-4",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    </div>
  );
}

/** "HH:mm" → "HH:mm" same-day duration label (e.g. "1 hr 15 min"). */
function sameDayDuration(start: string, end: string): string {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

// ───────────────────────────────────────────────────────────────────────
// ChannelCombobox — replaces the base-ui Select for channel selection.
// We render the channel name in the trigger ourselves rather than relying
// on SelectValue's auto-resolution, which intermittently shows the value
// (channelId) instead of the label depending on mount order.
// ───────────────────────────────────────────────────────────────────────

function ChannelCombobox({
  channels,
  value,
  onChange,
}: {
  channels: { _id: Id<"channels">; name: string }[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = channels.find((c) => c._id === value);
  // Wrapper rationale documented in DatePopover above — same FocusGuard
  // siblings + space-y-2 interaction.
  return (
    <div>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className="w-full justify-between font-normal"
            type="button"
          />
        }
      >
        <span className="flex items-center gap-1.5 truncate">
          {selected ? (
            <>
              <Hash className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{selected.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">No channel (standalone)</span>
          )}
        </span>
        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="p-0 w-72" align="start">
        <Command>
          <CommandInput placeholder="Search channels…" />
          <CommandList className="max-h-64">
            <CommandEmpty>No channels found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none"
                onSelect={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="cursor-pointer"
              >
                <span className="flex-1 text-muted-foreground">
                  No channel (standalone)
                </span>
                <Check
                  className={cn(
                    "ml-2 h-4 w-4",
                    !value ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>
              {channels.map((c) => (
                <CommandItem
                  key={c._id}
                  value={c.name}
                  onSelect={() => {
                    onChange(c._id);
                    setOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <Hash className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">{c.name}</span>
                  <Check
                    className={cn(
                      "ml-2 h-4 w-4",
                      c._id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    </div>
  );
}
