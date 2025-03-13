import { cn } from "@/lib/utils";
import { ChannelMember } from "@shared/types/channel";
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
import { ChannelRole } from "@shared/enums";
import { OptimisticUpdate } from "convex/browser";
import { FunctionArgs } from "convex/server";

const optimisticallyAddMemberToChannel: OptimisticUpdate<
  FunctionArgs<typeof api.channelMembers.addToChannel>
> = (lqs, { channelId, userId }) => {
  const existingChannelMembers = lqs.getQuery(api.channelMembers.membersByChannel, {
    channelId,
  });
  if (existingChannelMembers === undefined) return;

  lqs.setQuery(api.channelMembers.membersByChannel, { channelId }, [
    ...existingChannelMembers,
    {
      _id: crypto.randomUUID() as Id<"channelMembers">,
      _creationTime: +new Date(),
      channelId,
      userId,
      role: ChannelRole.MEMBER,
      name: "...",
    },
  ]);
};

// const optimisticallyRemoveFromChannel: OptimisticUpdate<
//   FunctionArgs<typeof api.channelMembers.removeFromChannel>
// > = (lqs, { channelId, userId }) => {
//   const existingChannelMembers = lqs.getQuery(api.channelMembers.membersByChannel, {
//     channelId,
//   });

//   if (existingChannelMembers === undefined) return;

//   const indexOfItemToRemove = existingChannelMembers.findIndex(
//     (member) => member.userId === userId,
//   );

//   if (indexOfItemToRemove === -1) return;

//   existingChannelMembers.splice(indexOfItemToRemove, 1);

//   lqs.setQuery(api.channelMembers.membersByChannel, { channelId }, existingChannelMembers);
// };

type ChannelMembershipSelectionProps = {
  workspaceMembers: Doc<"users">[];
  channelMembers: ChannelMember[];
  channelId: Id<"channels">;
};

export const ChannelMembershipSelection = ({
  workspaceMembers,
  channelMembers,
  channelId,
}: ChannelMembershipSelectionProps) => {
  const channelMemberIds = new Set(channelMembers.map(({ userId }) => userId));

  const addToChannel = useMutation(api.channelMembers.addToChannel).withOptimisticUpdate(
    optimisticallyAddMemberToChannel,
  );

  const removeFromChannel = useMutation(api.channelMembers.removeFromChannel); //
  // .withOptimisticUpdate(optimisticallyRemoveFromChannel);

  const { toast } = useToast();

  const [open, setOpen] = useState(false);

  const handleMemberSelection = (userId: Id<"users">) => {
    const handler = !channelMemberIds.has(userId) ? addToChannel : removeFromChannel;

    handler({ channelId, userId }).catch((error) => {
      if (error instanceof ConvexError) {
        toast({ title: "Error", description: error.data, variant: "destructive" });
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
            <span className="overflow-ellipsis">
              Add/Remove members...
            </span>
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
                        channelMemberIds.has(member._id) ? "opacity-100" : "opacity-0",
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
