import { useState } from "react";
import { Check, Mail, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Id } from "@convex/_generated/dataModel";

export type InviteeMember = {
  userId: Id<"users">;
  name: string;
  email?: string;
  image?: string;
};

/**
 * Two-input invitee picker:
 *   1. A combobox over workspace members (multi-select with checkmarks).
 *   2. A free-text email field for external guests, with a + button.
 *
 * The parent owns the selection state in both directions; this component is
 * purely presentational. It mirrors the Command + Popover pattern used by
 * TaskProperties.tsx so styles stay consistent.
 */
export function InviteeMultiSelect({
  members,
  selectedMemberIds,
  onSelectedMemberIdsChange,
  guestEmails: _guestEmails,
  onAddEmail,
  onRemoveEmail: _onRemoveEmail,
}: {
  members: InviteeMember[];
  selectedMemberIds: Id<"users">[];
  onSelectedMemberIdsChange: (ids: Id<"users">[]) => void;
  guestEmails: string[];
  onAddEmail: (raw: string) => void;
  /** Reserved for future "remove email" UI; consumers wire it up via the
   *  chip list below the picker today. */
  onRemoveEmail: (email: string) => void;
}) {
  const [memberOpen, setMemberOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");

  const toggleMember = (userId: Id<"users">) => {
    if (selectedMemberIds.includes(userId)) {
      onSelectedMemberIdsChange(selectedMemberIds.filter((id) => id !== userId));
    } else {
      onSelectedMemberIdsChange([...selectedMemberIds, userId]);
    }
  };

  const submitEmail = () => {
    if (!emailDraft.trim()) return;
    onAddEmail(emailDraft);
    setEmailDraft("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2">
        <Popover open={memberOpen} onOpenChange={setMemberOpen}>
          <PopoverTrigger render={
            <Button
              variant="outline"
              className="justify-between"
              type="button"
            >
              <span className="truncate text-muted-foreground">
                {selectedMemberIds.length === 0
                  ? "Add workspace members"
                  : `${selectedMemberIds.length} member${selectedMemberIds.length === 1 ? "" : "s"} selected`}
              </span>
            </Button>
          } />
          <PopoverContent className="p-0 w-65" align="start">
            <Command>
              <CommandInput placeholder="Search members…" />
              <CommandList>
                <CommandEmpty>No members found.</CommandEmpty>
                <CommandGroup>
                  {members.map((m) => {
                    const selected = selectedMemberIds.includes(m.userId);
                    return (
                      <CommandItem
                        key={m.userId}
                        value={`${m.name} ${m.email ?? ""}`}
                        onSelect={() => toggleMember(m.userId)}
                        className="cursor-pointer"
                      >
                        <Avatar className="size-5 mr-2">
                          {m.image && <AvatarImage src={m.image} alt={m.name} />}
                          <AvatarFallback>
                            {m.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="flex-1 truncate">{m.name}</span>
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

        <div className="flex items-center gap-1 sm:flex-1">
          <div className="relative flex-1">
            <Mail className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="email"
              placeholder="Add guest by email"
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitEmail();
                }
              }}
              className="pl-7"
            />
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={submitEmail}
            aria-label="Add guest email"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
