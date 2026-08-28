import { useMutation } from "convex/react";
import { Check, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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
import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type KanbanAssigneePickerProps = {
  taskId: Id<"tasks">;
  assigneeId?: Id<"users">;
  assignee: { name?: string | null; image?: string } | null;
};

/**
 * Inline assignee control on a kanban card: assigning shouldn't cost a trip
 * through the task detail sheet. Unassigned renders as a dotted circle in the
 * slot the avatar would occupy (so card height never shifts); assigned renders
 * the avatar itself. Either one opens the member combobox.
 *
 * The card is both a drag handle and a click target for the detail sheet, so
 * every pointer event the trigger sees is stopped here — otherwise a pick
 * would start a drag and land on the detail sheet on release.
 */
export function KanbanAssigneePicker({
  taskId,
  assigneeId,
  assignee,
}: KanbanAssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const members = useWorkspaceMembers();
  const updateTask = useMutation(api.tasks.update);

  const assign = (nextAssigneeId: Id<"users"> | null) => {
    setOpen(false);
    if ((assigneeId ?? null) === nextAssigneeId) return;
    void updateTask({ taskId, assigneeId: nextAssigneeId }).catch(
      (err: unknown) => {
        toast.error("Couldn't change assignee", {
          description: getErrorMessage(err),
        });
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            // The card owns dnd-kit's listeners and the detail-sheet click.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors",
              assignee
                ? "hover:ring-2 hover:ring-ring/50"
                : "border border-dotted border-muted-foreground/60 text-muted-foreground/70 hover:border-foreground hover:text-foreground",
            )}
            aria-label={
              assignee
                ? `Assignee: ${assignee.name ?? "unnamed"}. Change assignee`
                : "Assign task"
            }
            title={assignee ? (assignee.name ?? "Assignee") : "Assign task"}
          />
        }
      >
        {assignee ? (
          <UserAvatar
            className="h-6 w-6"
            name={assignee.name}
            image={assignee.image}
            alt={assignee.name ?? "Assignee"}
            fallbackClassName="text-xs"
          />
        ) : (
          <UserRound className="h-3 w-3" />
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-56 p-0"
        // Same reason as the trigger: the popup is portalled out of the card,
        // but a stray pointerdown inside it must never reach the board.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder="Assign to…" />
          <CommandList>
            <CommandEmpty>No members</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="Unassigned"
                onSelect={() => assign(null)}
                className="cursor-pointer"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dotted border-muted-foreground/60">
                  <UserRound className="h-2.5 w-2.5 text-muted-foreground" />
                </span>
                <span className="flex-1 truncate text-muted-foreground">
                  Unassigned
                </span>
                <Check
                  className={cn("h-4 w-4", assigneeId ? "opacity-0" : "opacity-100")}
                />
              </CommandItem>
              {(members ?? []).map((member) => {
                const selected = member._id === assigneeId;
                return (
                  <CommandItem
                    key={member._id}
                    value={`${member.name ?? ""} ${member.email ?? ""}`}
                    onSelect={() => assign(member._id)}
                    className="cursor-pointer"
                  >
                    <UserAvatar
                      className="h-5 w-5"
                      name={member.name}
                      image={member.image}
                      alt={member.name ?? "Member"}
                      fallbackClassName="text-[10px]"
                    />
                    <span className="flex-1 truncate">{member.name}</span>
                    <Check
                      className={cn(
                        "h-4 w-4",
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
