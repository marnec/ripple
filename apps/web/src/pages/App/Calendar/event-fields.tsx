/**
 * Shared event-form field components used by both `CreateEventDialog` (modal
 * compose flow) and `EventDetailSheet` (inline edit-in-place). Keeping these
 * here means the two surfaces share identical popovers, parsing rules, and
 * keyboard behaviour — so editing an event feels like creating one in
 * miniature, and vice-versa.
 *
 * The exports are deliberately small leaves rather than one mega-form so the
 * inline-edit surface can wire each one up to its own autosave handler
 * without inheriting the create-flow's React-Hook-Form context.
 */

import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { CalendarIcon, Check, ChevronsUpDown, Hash } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { Id } from "@convex/_generated/dataModel";

import { TIME_OPTIONS, formatTimeLabel, parseTypedTime, sameDayDuration } from "./event-time-utils";

// ───────────────────────────────────────────────────────────────────────────
// DatePopover — shadcn `Calendar` in a popover.
// ───────────────────────────────────────────────────────────────────────────

export function DatePopover({
  value,
  onChange,
  triggerClassName,
}: {
  value: Date | undefined;
  onChange: (d: Date) => void;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  // The wrapper <div> is load-bearing: base-ui's PopoverPortal injects
  // FocusGuard <span>s as siblings of the trigger. Without this wrapper
  // they leak into a parent FormItem's space-y-* layout and shift the
  // dialog. See the original CreateEventDialog comment for the full story.
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
                triggerClassName,
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

// ───────────────────────────────────────────────────────────────────────────
// TimeSelect — Popover + Command listing 15-min increments, plus:
//   • scroll-to-selected on open (so the user lands on their pick instead
//     of midnight in a 96-row list)
//   • free-typed time: type "10:42" / "10am" / "1042" / "10.5pm" → an
//     "Use 10:42 AM" suggestion appears at the top of the list. Selecting
//     it commits an off-grid value the dropdown can't display otherwise.
//
// `startTime` (when provided) annotates each later slot with a duration
// label — same behaviour as the create dialog historically.
// ───────────────────────────────────────────────────────────────────────────

export function TimeSelect({
  value,
  onChange,
  startTime,
  triggerClassName,
  triggerSize = "default",
}: {
  value: string;
  onChange: (v: string) => void;
  startTime?: string;
  triggerClassName?: string;
  triggerSize?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Scroll the selected slot into view whenever the popover opens. We use
  // useLayoutEffect so the scroll happens before paint, killing the visible
  // jump that `behavior: "smooth"` + a deferred effect would produce.
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    // base-ui Popover mounts the content asynchronously — the list element
    // can be null on the first render after `open=true`. Two RAFs gives the
    // portal a chance to mount before we look up the data-attribute.
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const list = listRef.current;
        if (!list) return;
        const target = list.querySelector<HTMLElement>(`[data-time-slot="${CSS.escape(value)}"]`);
        if (!target) return;
        // `block: "center"` keeps a few neighbours visible on either side
        // so users get spatial context, not just their own pick.
        target.scrollIntoView({ block: "center" });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, value]);

  // The query reset on popover close is handled inline in `onOpenChange`
  // below — moving it out of an effect avoids the cascading-render warning
  // and matches when the close event actually fires.

  // Free-typed-time suggestion: parse the query; if it lands on a value
  // outside the 15-min grid (or the grid would otherwise filter it out),
  // surface a dedicated row so users can commit it without scrolling.
  const typedTime = parseTypedTime(query);
  const showTypedSuggestion = typedTime !== null && !TIME_OPTIONS.includes(typedTime);

  // Allow Enter on the search input to commit a typed time directly — most
  // users won't bother arrowing down to the suggestion row.
  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && typedTime) {
      e.preventDefault();
      onChange(typedTime);
      setOpen(false);
    }
  };

  const triggerHeight = triggerSize === "sm" ? "h-8 text-xs px-2.5" : "";

  return (
    <div>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              className={cn("font-normal", triggerHeight, triggerClassName)}
              type="button"
            >
              <div className="flex gap-1 items-center">
                <div>{value ? formatTimeLabel(value) : "Select time"}</div>
                <ChevronsUpDown className="opacity-50" />
              </div>
            </Button>
          }
        ></PopoverTrigger>
        <PopoverContent className="p-0 w-48" align="start">
          <Command
            // Disable the built-in fuzzy filter — our search input is also
            // the free-typed-time input, and "10am" should NOT filter out
            // "10:00 AM" via prefix match. We do our own filtering below.
            shouldFilter={false}
          >
            <CommandInput
              placeholder="Type a time…"
              value={query}
              onValueChange={setQuery}
              onKeyDown={onInputKeyDown}
            />
            <CommandList ref={listRef} className="max-h-64">
              {showTypedSuggestion && (
                <CommandGroup heading="Custom time">
                  <CommandItem
                    value={`__typed-${typedTime}`}
                    onSelect={() => {
                      onChange(typedTime);
                      setOpen(false);
                    }}
                    className="cursor-pointer"
                  >
                    <span className="flex-1">
                      Use{" "}
                      <span className="font-medium tabular-nums">{formatTimeLabel(typedTime)}</span>
                    </span>
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandEmpty>No times.</CommandEmpty>
              <CommandGroup>
                {TIME_OPTIONS.filter((slot) => {
                  if (query === "") return true;
                  // Match against both the raw "HH:mm" and the localised
                  // label so users can type "10:30" or "10:30 AM".
                  const haystack = `${slot} ${formatTimeLabel(slot)}`.toLowerCase();
                  return haystack.includes(query.toLowerCase());
                }).map((slot) => {
                  const selected = slot === value;
                  const duration =
                    startTime && slot > startTime ? sameDayDuration(startTime, slot) : null;
                  return (
                    <CommandItem
                      key={slot}
                      value={slot}
                      data-time-slot={slot}
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
                        className={cn("ml-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")}
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

// ───────────────────────────────────────────────────────────────────────────
// ChannelCombobox — channel picker with explicit "no channel" option.
// ───────────────────────────────────────────────────────────────────────────

export function ChannelCombobox({
  channels,
  value,
  onChange,
  triggerClassName,
}: {
  channels: { _id: Id<"channels">; name: string }[];
  value: string;
  onChange: (next: string) => void;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = channels.find((c) => c._id === value);
  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              className={cn("w-full justify-between font-normal", triggerClassName)}
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
                  <span className="flex-1 text-muted-foreground">No channel (standalone)</span>
                  <Check className={cn("ml-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
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
                      className={cn("ml-2 h-4 w-4", c._id === value ? "opacity-100" : "opacity-0")}
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
