/**
 * The escape hatch behind *Custom…*: an interval, the monthly mode where it
 * applies, and an end that is a date, a count, or never.
 *
 * It edits a **draft**. Nothing reaches the form until *Done*, so cancelling —
 * by the button, by Escape, by clicking away — leaves the preset the organizer
 * had chosen exactly as it was. The draft is seeded once per opening, which is
 * why the parent remounts this by key rather than syncing props into state.
 *
 * The occurrence count under the controls comes from the shared recurrence
 * module, never from arithmetic here: the number the organizer is shown before
 * saving has to be the number the backend will produce.
 */
import { useState } from "react";
import type { RecurrenceRule, SeriesAnchor, Weekday } from "@ripple/shared/recurrence";

import { Button } from "@ripple/ui/components/button";
import { Input } from "@ripple/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ripple/ui/components/select";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

import { DatePopover } from "./event-fields";
import { toLocalIsoDate } from "./event-time-utils";
import { nthWeekdayOf, previewRecurrence, weekdayOf } from "./recurrence-presets";

/** ISO weekday order — the order `BYDAY` uses and the order a week reads in. */
const WEEKDAY_BUTTONS: Array<{ value: Weekday; short: string; label: string }> = [
  { value: "monday", short: "M", label: "Monday" },
  { value: "tuesday", short: "T", label: "Tuesday" },
  { value: "wednesday", short: "W", label: "Wednesday" },
  { value: "thursday", short: "T", label: "Thursday" },
  { value: "friday", short: "F", label: "Friday" },
  { value: "saturday", short: "S", label: "Saturday" },
  { value: "sunday", short: "S", label: "Sunday" },
];

const ORDINAL_LABEL = ["first", "second", "third", "fourth", "fifth"] as const;

const FREQ_UNIT: Record<RecurrenceRule["freq"], [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
  yearly: ["year", "years"],
};

/** "YYYY-MM-DD" as a date in the *local* calendar, the inverse of `toLocalIsoDate`. */
function fromLocalIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function addYears(date: Date, years: number): Date {
  const out = new Date(date);
  out.setFullYear(out.getFullYear() + years);
  return out;
}

export function RecurrenceDialog({
  open,
  onOpenChange,
  date,
  anchor,
  initialRule,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The date the event is on — it names the monthly modes and seeds the end. */
  date: Date;
  /** What the series would be anchored to, so the preview counts the real thing. */
  anchor: SeriesAnchor;
  /** Seeded once, at mount. The parent remounts by key to reseed. */
  initialRule: RecurrenceRule;
  onConfirm: (rule: RecurrenceRule) => void;
}) {
  const [rule, setRule] = useState<RecurrenceRule>(initialRule);
  // The interval lives as text so the field can be empty mid-typing without
  // snapping back to 1 under the organizer's cursor.
  const [intervalText, setIntervalText] = useState(String(initialRule.interval));

  const preview = previewRecurrence(rule, anchor);

  const patch = (next: Partial<RecurrenceRule>) => setRule((r) => ({ ...r, ...next }));

  const handleFreqChange = (freq: RecurrenceRule["freq"]) => {
    // Each frequency carries only the qualifiers it can mean. Leaving a stale
    // `weekdays` on a monthly rule would serialize a BYDAY nobody chose.
    if (freq === "weekly") {
      patch({ freq, weekdays: rule.weekdays ?? [weekdayOf(date)], monthlyMode: undefined });
    } else if (freq === "monthly") {
      patch({ freq, weekdays: undefined, monthlyMode: rule.monthlyMode ?? "nthWeekday" });
    } else {
      patch({ freq, weekdays: undefined, monthlyMode: undefined });
    }
  };

  const handleIntervalChange = (text: string) => {
    setIntervalText(text);
    // An empty or half-typed field is not a rule change; the preview keeps
    // showing the last whole number rather than flickering a refusal.
    const n = Number(text);
    if (Number.isInteger(n) && n >= 1) patch({ interval: n });
  };

  const handleEndKindChange = (kind: RecurrenceRule["end"]["kind"]) => {
    if (kind === "never") patch({ end: { kind: "never" } });
    else if (kind === "afterCount") patch({ end: { kind: "afterCount", count: 12 } });
    else patch({ end: { kind: "onDate", date: toLocalIsoDate(addYears(date, 1)) } });
  };

  const ordinal = ORDINAL_LABEL[nthWeekdayOf(date) - 1] ?? "first";
  const weekdayName = WEEKDAY_BUTTONS.find((w) => w.value === weekdayOf(date))?.label;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} direction="top">
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Custom repeat</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            How often this meeting happens, and when it stops.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="space-y-4">
          <div className="space-y-2">
            <Label>Repeat every</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                aria-label="Repeat interval"
                className="w-20"
                value={intervalText}
                onChange={(e) => handleIntervalChange(e.target.value)}
              />
              <Select
                value={rule.freq}
                onValueChange={(v) => handleFreqChange(v as RecurrenceRule["freq"])}
              >
                <SelectTrigger className="flex-1" aria-label="Repeat unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    ["daily", "weekly", "monthly", "yearly"] as const
                  ).map((f) => (
                    <SelectItem key={f} value={f}>
                      {rule.interval === 1 ? FREQ_UNIT[f][0] : FREQ_UNIT[f][1]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {rule.freq === "weekly" && (
            <div className="space-y-2">
              <Label>Repeat on</Label>
              <ToggleGroup
                size="sm"
                spacing={1}
                value={rule.weekdays ?? []}
                onValueChange={(values) =>
                  patch({ weekdays: values as Weekday[] })
                }
              >
                {WEEKDAY_BUTTONS.map((w) => (
                  <ToggleGroupItem
                    key={w.value}
                    value={w.value}
                    aria-label={w.label}
                    className="w-8"
                  >
                    {w.short}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}

          {rule.freq === "monthly" && (
            <div className="space-y-2">
              <Label>Repeat by</Label>
              <Select
                value={rule.monthlyMode ?? "nthWeekday"}
                onValueChange={(v) =>
                  patch({ monthlyMode: v as "dayOfMonth" | "nthWeekday" })
                }
              >
                <SelectTrigger aria-label="Monthly mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nthWeekday">
                    On the {ordinal} {weekdayName}
                  </SelectItem>
                  <SelectItem value="dayOfMonth">
                    On day {date.getDate()}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Ends</Label>
            <div className="flex gap-2">
              <Select
                value={rule.end.kind}
                onValueChange={(v) =>
                  handleEndKindChange(v as RecurrenceRule["end"]["kind"])
                }
              >
                <SelectTrigger className="flex-1" aria-label="How the series ends">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="onDate">On date</SelectItem>
                  <SelectItem value="afterCount">After</SelectItem>
                </SelectContent>
              </Select>

              {rule.end.kind === "onDate" && (
                <DatePopover
                  value={fromLocalIsoDate(rule.end.date)}
                  onChange={(d) =>
                    patch({ end: { kind: "onDate", date: toLocalIsoDate(d) } })
                  }
                  triggerClassName="flex-1"
                />
              )}

              {rule.end.kind === "afterCount" && (
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    aria-label="Number of occurrences"
                    className="w-20"
                    value={rule.end.count}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isInteger(n) && n >= 1) {
                        patch({ end: { kind: "afterCount", count: n } });
                      }
                    }}
                  />
                  <span className="text-sm text-muted-foreground">
                    occurrence{rule.end.count === 1 ? "" : "s"}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* The whole point of the dialog: the organizer learns what the rule
              comes to before fifty invitations go out, and a rule past a limit
              says which limit rather than quietly producing a shorter series. */}
          <p
            className={
              preview.ok
                ? "text-xs text-muted-foreground"
                : "text-xs text-destructive"
            }
          >
            {preview.ok ? preview.text : preview.message}
          </p>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!preview.ok}
            onClick={() => {
              onConfirm(rule);
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
