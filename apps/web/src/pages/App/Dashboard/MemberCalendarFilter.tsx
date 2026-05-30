import { useState } from "react";
import { Check, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { UserAvatar } from "@/components/UserAvatar";
import { cn } from "@/lib/utils";
import type { Id } from "@convex/_generated/dataModel";

import { memberHueFor } from "./member-calendar-colors";

export type MemberCalendarMember = {
  userId: Id<"users">;
  name: string;
  email?: string;
  image?: string;
};

/**
 * Header combobox that picks which workspace members' calendars overlay
 * the dashboard calendar as background "busy" blocks. Mirrors the member
 * half of `<InviteeMultiSelect />` but without the email half — overlays
 * are workspace-internal only.
 *
 * The trigger lives in the calendar header next to the "Today" button.
 * Empty selection ⇒ ghost icon; ≥1 selected ⇒ count badge so the user
 * knows the overlay is active even when scrolled away from the
 * highlighted blocks.
 */
export function MemberCalendarFilter({
  members,
  selectedIds,
  onSelectedIdsChange,
}: {
  members: MemberCalendarMember[];
  selectedIds: Id<"users">[];
  onSelectedIdsChange: (ids: Id<"users">[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (userId: Id<"users">) => {
    if (selectedIds.includes(userId)) {
      onSelectedIdsChange(selectedIds.filter((id) => id !== userId));
    } else {
      onSelectedIdsChange([...selectedIds, userId]);
    }
  };

  const count = selectedIds.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            // Match the Today button's height + spacing so the two sit
            // visually on the same row.
            className="h-7 text-xs text-muted-foreground relative"
            aria-label="Filter member calendars"
          >
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">
              {count === 0
                ? "Member calendars"
                : `${count} member${count === 1 ? "" : "s"}`}
            </span>
            {count > 0 && (
              // Mobile: the label text is hidden, so a tiny dot badge
              // signals "filter active" without taking horizontal space.
              <span
                className={cn(
                  "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary",
                  "sm:hidden",
                )}
                aria-hidden
              />
            )}
          </Button>
        }
      />
      <PopoverContent className="p-0 w-65" align="start">
        <Command>
          <CommandInput placeholder="Search members…" />
          <CommandList>
            <CommandEmpty>No members</CommandEmpty>
            <CommandGroup>
              {members.map((m) => {
                const selected = selectedIds.includes(m.userId);
                const hue = memberHueFor(m.userId);
                return (
                  <CommandItem
                    key={m.userId}
                    value={`${m.name} ${m.email ?? ""}`}
                    onSelect={() => toggle(m.userId)}
                    className="cursor-pointer"
                  >
                    <UserAvatar
                      className="size-5 mr-2"
                      name={m.name}
                      image={m.image}
                    />
                    <span className="flex-1 truncate">{m.name}</span>
                    {/* Tiny colour swatch so the user knows which hue
                        their busy-blocks will use before toggling on. */}
                    <span
                      className="ml-2 h-2.5 w-2.5 rounded-full shrink-0"
                      style={{
                        background: `hsl(${hue} 70% 55%)`,
                        opacity: selected ? 1 : 0.35,
                      }}
                      aria-hidden
                    />
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
  );
}
