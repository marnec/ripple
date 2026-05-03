import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ChannelRole } from "@shared/enums";
import { getUserDisplayName } from "@shared/displayName";
import type { ChannelMember } from "@shared/types/channel";
import type { Values } from "@shared/types/object";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { Shield, User, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

interface ChannelMembersSectionProps {
  channelId: Id<"channels">;
  channelType: "open" | "closed" | "dm";
  isAdmin: boolean;
  currentUserId: Id<"users">;
  channelMembers: ChannelMember[];
  availableMembers: Doc<"users">[];
}

export function ChannelMembersSection({
  channelId,
  channelType,
  isAdmin,
  currentUserId,
  channelMembers,
  availableMembers,
}: ChannelMembersSectionProps) {
  const addToChannel = useMutation(api.channelMembers.addToChannel);
  const removeFromChannel = useMutation(api.channelMembers.removeFromChannel);
  const changeMemberRole = useMutation(api.channelMembers.changeMemberRole);

  const handleAdd = (userId: Id<"users">) => {
    addToChannel({ channelId, userId }).catch((error) => {
      if (error instanceof ConvexError) {
        toast.error("Error", { description: String(error.data) });
      }
    });
  };

  const handleRemove = (userId: Id<"users">) => {
    removeFromChannel({ channelId, userId }).catch((error) => {
      if (error instanceof ConvexError) {
        toast.error("Error", { description: String(error.data) });
      }
    });
  };

  const handleRoleChange = (
    channelMemberId: Id<"channelMembers">,
    role: Values<typeof ChannelRole>,
  ) => {
    changeMemberRole({ channelMemberId, role }).catch((error) => {
      if (error instanceof ConvexError) {
        toast.error("Error", { description: String(error.data) });
      }
    });
  };

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-4">Members</h2>

      {channelType === "closed" && isAdmin && availableMembers.length > 0 && (
        <AddMemberSelect
          availableMembers={availableMembers}
          onAdd={handleAdd}
        />
      )}

      {channelType === "open" && (
        <p className="text-sm text-muted-foreground mb-4">
          All workspace members have access to this open channel.
        </p>
      )}

      <div className="space-y-2">
        {channelMembers.map((member) => (
          <MemberRow
            key={member._id}
            member={member}
            isAdmin={isAdmin}
            isClosed={channelType === "closed"}
            currentUserId={currentUserId}
            onRoleChange={handleRoleChange}
            onRemove={handleRemove}
          />
        ))}
        {channelMembers.length === 0 && channelType !== "open" && (
          <p className="text-sm text-muted-foreground py-3">
            No members yet. Add members above to get started.
          </p>
        )}
      </div>
    </section>
  );
}

function AddMemberSelect({
  availableMembers,
  onAdd,
}: {
  availableMembers: Doc<"users">[];
  onAdd: (userId: Id<"users">) => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  return (
    <div className="flex gap-2 mb-4">
      <Select value={selectedUserId} onValueChange={(v) => { if (v !== null) setSelectedUserId(v); }}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Select a member to add" />
        </SelectTrigger>
        <SelectContent>
          {availableMembers.map((member) => (
            <SelectItem key={member._id} value={member._id}>
              {getUserDisplayName(member)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        onClick={() => {
          if (selectedUserId) {
            onAdd(selectedUserId as Id<"users">);
            setSelectedUserId("");
          }
        }}
        disabled={!selectedUserId}
      >
        <UserPlus className="w-4 h-4 mr-2" />
        Add
      </Button>
    </div>
  );
}

function MemberRow({
  member,
  isAdmin,
  isClosed,
  currentUserId,
  onRoleChange,
  onRemove,
}: {
  member: ChannelMember;
  isAdmin: boolean;
  isClosed: boolean;
  currentUserId: Id<"users">;
  onRoleChange: (id: Id<"channelMembers">, role: Values<typeof ChannelRole>) => void;
  onRemove: (userId: Id<"users">) => void;
}) {
  const isSelf = member.userId === currentUserId;

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border">
      <div className="flex items-center gap-3 min-w-0">
        <User className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">{member.name}</span>
        {member.role === ChannelRole.ADMIN && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Shield className="w-3 h-3" />
            Admin
          </span>
        )}
        {isSelf && (
          <span className="text-xs text-muted-foreground shrink-0">(you)</span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isAdmin && isClosed && (
          <Select
            value={member.role}
            onValueChange={(role) => {
              if (role !== null) onRoleChange(member._id, role);
            }}
          >
            <SelectTrigger className="w-27.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ChannelRole).map(([label, value]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {isAdmin && isClosed && !isSelf && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(member.userId)}
          >
            <UserMinus className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
