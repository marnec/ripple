import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
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

  // End-time auto-bump: when the user shifts the start, slide the end with
  // it so the duration is preserved. While the end is still pristine
  // (untouched since defaults seeded a +1h slot), the bump locks the
  // duration to exactly 60 min — that re-pegs the end if the user picks a
  // start far from the seeded one without ever interacting with the end
  // picker. The moment the user opens the end picker we flip
  // `endTouchedRef` to true and switch to delta-preservation, matching
  // Google Calendar's behaviour. Stored in a ref because the value is read
  // & written from event handlers and never needs to drive a re-render.
  const endTouchedRef = useRef(false);

  const handleStartChange = (newStart: string) => {
    // Read current values BEFORE the form update propagates so the delta
    // is computed against the previous start, not the new one.
    const prevStart = form.getValues("startTime");
    const prevEnd = form.getValues("endTime");
    form.setValue("startTime", newStart, { shouldValidate: true });

    if (!endTouchedRef.current) {
      // Pristine end — relock to start + 1h.
      form.setValue("endTime", addMinutes(newStart, 60), { shouldValidate: true });
      return;
    }
    // Touched end — preserve the user-set duration, including the
    // cross-midnight case (negative same-day delta). `addMinutes` wraps at
    // 24h so the wrapped end correctly signals "+1 day" downstream.
    const prevDelta = TIME_RE.test(prevStart) && TIME_RE.test(prevEnd)
      ? (timeToMinutes(prevEnd) - timeToMinutes(prevStart) + 24 * 60) % (24 * 60)
      : 60;
    form.setValue("endTime", addMinutes(newStart, prevDelta || 60), {
      shouldValidate: true,
    });
  };

  const handleEndChange = (newEnd: string) => {
    endTouchedRef.current = true;
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
                      <TimeSelect value={field.value} onChange={handleStartChange} />
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
                        onChange={handleEndChange}
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

