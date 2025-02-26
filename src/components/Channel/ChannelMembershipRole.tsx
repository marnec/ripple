import { ChannelRole } from "@shared/enums";
import { ChannelMember } from "@shared/types/channel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Values } from "@shared/types/object";
import { User } from "lucide-react";

type ChannelMembershipRoleProps = {
  channelMembers: ChannelMember[];
};

export const ChannelMembershipRole = ({ channelMembers }: ChannelMembershipRoleProps) => {
  // from https://github.com/shadcn-ui/ui/issues/2760
  // and https://github.com/shadcn-ui/ui/discussions/1380

  const changeMemberRole = useMutation(api.channelMembers.changeMemberRole);

  const handleRoleSelection = (
    channelMemberId: Id<"channelMembers">,
    role: Values<typeof ChannelRole>,
  ) => {
    changeMemberRole({ channelMemberId, role });
  };

  return (
    <>
      {channelMembers.map((member, index) => (
        <div
          key={member.userId}
          className="flex flex-row items-center justify-between w-full sm:w-1/2"
        >
          <div className="flex items-center gap-3 truncate ">
            <User className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground truncate">
              {channelMembers[index].name}
            </span>
          </div>

          <div>
            <Select
              onValueChange={(role: Values<typeof ChannelRole>) =>
                handleRoleSelection(member._id, role)
              }
              defaultValue={member.role}
              value={member.role}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>

              <SelectContent>
                {Object.entries(ChannelRole).map(([roleName, roleValue]) => (
                  <SelectItem key={roleName} value={roleValue}>
                    {roleName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ))}
    </>
  );
};
