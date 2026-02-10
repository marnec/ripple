import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { Button } from "../../../components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../../components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { useToast } from "../../../components/ui/use-toast";
import { DiagramMember } from "@shared/types/diagram";

type DiagramMembershipSelectionProps = {
  workspaceMembers: Doc<"users">[];
  diagramMembers: DiagramMember[];
  diagramId: Id<"diagrams">;
};

export const DiagramMembershipSelection = ({
  workspaceMembers,
  diagramMembers,
  diagramId,
}: DiagramMembershipSelectionProps) => {
  const diagramMemberIds = new Set(diagramMembers.map(({ userId }) => userId));

  const addMember = useMutation(api.diagramMembers.addMember);
  const removeMember = useMutation(api.diagramMembers.removeMember);

  const { toast } = useToast();

  const [open, setOpen] = useState(false);

  const handleMemberSelection = (userId: Id<"users">) => {
    const handler = !diagramMemberIds.has(userId) ? addMember : removeMember;

    handler({ diagramId, userId }).catch((error) => {
      if (error instanceof ConvexError) {
        toast({ title: "Error", description: error.data as string, variant: "destructive" });
      }
    });
  };

  return (
    <div className="flex items-center space-x-4 w-full sm:w-1/2">
      <p className="text-sm text-muted-foreground">Members</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="justify-between w-full"
          >
            <span className="overflow-ellipsis">Add/Remove members...</span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <Command
            filter={(value, search) => {
              const member = workspaceMembers.find((user) => user._id === value);
              if ((member?.name || member?.email)?.toLowerCase().includes(search.toLowerCase()))
                return 1;
              else return 0;
            }}
          >
            <CommandInput placeholder="Search users in workspace..." className="h-9" />
            <CommandList>
              <CommandEmpty>No framework found.</CommandEmpty>
              <CommandGroup>
                {workspaceMembers.map((member) => (
                  <CommandItem
                    key={member._id}
                    value={member._id}
                    onSelect={() => handleMemberSelection(member._id)}
                  >
                    {member.name || member.email}
                    <Check
                      className={cn(
                        "ml-auto",
                        diagramMemberIds.has(member._id) ? "opacity-100" : "opacity-0",
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
};
