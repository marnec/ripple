import { useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  MemberCount,
  MemberList,
  MemberListEmpty,
  MemberListItem,
  MemberRoleBadge,
  MemberRoleSelect,
  MemberSearchInput,
  RemoveMemberButton,
} from "@/components/MemberList";
import { byRoleThenName, matchesMemberQuery } from "@/lib/member-list";
import { UserAvatar } from "@/components/UserAvatar";
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
import { Button } from "@ripple/ui/components/button";
import { ChannelVisibility } from "@ripple/shared/enums";
import { getUserDisplayName } from "@ripple/shared/displayName";
import type { ChannelMember } from "@convex/types/channel";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { ChannelVisibilityValue } from "@/lib/channel-visibility";

/** Above this, scanning the list beats reading it, so the filter appears. */
const SEARCH_THRESHOLD = 8;

interface ChannelMembersSectionProps {
  channelId: Id<"channels">;
  /** Only a channel reaches this section, so it always has one. */
  channelVisibility: ChannelVisibilityValue | undefined;
  isAdmin: boolean;
  currentUserId: Id<"users">;
  channelMembers: ChannelMember[];
  /**
   * Every member of the owning workspace. The roster rows carry no avatar of
   * their own (`membersByChannel` returns the denormalized name, not the user
   * row), so the picture comes from the workspace roster the settings page has
   * already loaded, and the same list minus the current members is who can
   * still be added.
   */
  workspaceUsers: Doc<"users">[];
}

export function ChannelMembersSection({
  channelId,
  channelVisibility,
  isAdmin,
  currentUserId,
  channelMembers,
  workspaceUsers,
}: ChannelMembersSectionProps) {
  const addToChannel = useMutation(api.channelMembers.addToChannel);
  const removeFromChannel = useMutation(api.channelMembers.removeFromChannel);
  const changeMemberRole = useMutation(api.channelMembers.changeMemberRole);

  const [query, setQuery] = useState("");
  // The member awaiting Remove confirmation (null = dialog closed).
  const [removeTarget, setRemoveTarget] = useState<{
    userId: Id<"users">;
    name: string;
  } | null>(null);

  const isPrivate = channelVisibility === ChannelVisibility.PRIVATE;
  const isPublic = channelVisibility === ChannelVisibility.PUBLIC;
  /** Roles and membership are only editable where membership is a decision. */
  const canManage = isAdmin && isPrivate;

  const imageByUserId = new Map(workspaceUsers.map((u) => [u._id, u.image]));
  const memberIds = new Set(channelMembers.map((m) => m.userId));
  const availableMembers = workspaceUsers.filter((u) => !memberIds.has(u._id));

  const visible = channelMembers
    .filter((member) => matchesMemberQuery(member, query))
    .sort(byRoleThenName);

  // Three ways a list can come up empty, and they call for different words:
  // a public channel has a roster only once people join it, a private one is
  // waiting for its admin to add someone, and a filter can simply match nobody.
  const emptyCopy =
    channelMembers.length > 0
      ? `No members match “${query}”.`
      : isPublic
        ? "No one has joined yet. Every workspace member can open this channel."
        : canManage
          ? "No members yet. Add the first one to get started."
          : "No members yet.";

  const reportError = (error: unknown) => {
    if (error instanceof ConvexError) {
      toast.error("Error", { description: String(error.data) });
    }
  };

  const handleAdd = (userId: Id<"users">, name: string) => {
    addToChannel({ channelId, userId })
      .then(() => toast.success(`${name} was added to the channel`))
      .catch(reportError);
  };

  const handleRoleChange = (
    channelMemberId: Id<"channelMembers">,
    role: "admin" | "member",
  ) => {
    changeMemberRole({ channelMemberId, role }).catch(reportError);
  };

  const confirmRemove = () => {
    if (!removeTarget) return;
    const { userId, name } = removeTarget;
    setRemoveTarget(null);
    removeFromChannel({ channelId, userId })
      .then(() => toast.success(`${name} was removed from the channel`))
      .catch(reportError);
  };

  return (
    <div className="space-y-3">
      {isPublic && (
        <p className="text-sm text-muted-foreground">
          All workspace members have access to this public channel.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <MemberCount shown={visible.length} total={channelMembers.length} />
        <div className="flex items-center gap-2">
          {channelMembers.length > SEARCH_THRESHOLD && (
            <MemberSearchInput value={query} onChange={setQuery} />
          )}
          {canManage && availableMembers.length > 0 && (
            <AddMemberPicker members={availableMembers} onAdd={handleAdd} />
          )}
        </div>
      </div>

      <MemberList>
        {visible.map((member) => {
          const isSelf = member.userId === currentUserId;
          return (
            <MemberListItem
              key={member._id}
              name={member.name}
              email={member.email}
              image={imageByUserId.get(member.userId)}
              isSelf={isSelf}
            >
              {canManage ? (
                <>
                  <MemberRoleSelect
                    value={member.role}
                    memberName={member.name}
                    onValueChange={(role) => handleRoleChange(member._id, role)}
                  />
                  {!isSelf && (
                    <RemoveMemberButton
                      memberName={member.name}
                      onClick={() =>
                        setRemoveTarget({ userId: member.userId, name: member.name })
                      }
                    />
                  )}
                </>
              ) : (
                <MemberRoleBadge role={member.role} />
              )}
            </MemberListItem>
          );
        })}

        {visible.length === 0 && (
          <MemberListEmpty>{emptyCopy}</MemberListEmpty>
        )}
      </MemberList>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        onConfirm={confirmRemove}
        title="Remove member?"
        description={
          removeTarget && (
            <>
              Remove <span className="font-medium">{removeTarget.name}</span> from
              this channel? They will lose access to its conversation. You can add
              them back later.
            </>
          )
        }
        confirmLabel="Remove"
      />
    </div>
  );
}

/**
 * Search-first "add member": a workspace can hold more people than a plain
 * select is comfortable to scroll, and picking someone IS the action, so there
 * is no second Add button to press afterwards.
 */
function AddMemberPicker({
  members,
  onAdd,
}: {
  members: Doc<"users">[];
  onAdd: (userId: Id<"users">, name: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <UserPlus className="size-4" />
            Add member
          </Button>
        }
      />
      <PopoverContent className="w-64 p-0" align="end">
        <Command>
          <CommandInput placeholder="Search members" />
          <CommandList>
            <CommandEmpty>No members found.</CommandEmpty>
            <CommandGroup>
              {members.map((member) => {
                const name = getUserDisplayName(member);
                return (
                  <CommandItem
                    key={member._id}
                    value={`${name} ${member.email ?? ""}`}
                    onSelect={() => {
                      onAdd(member._id, name);
                      setOpen(false);
                    }}
                    className="cursor-pointer"
                  >
                    <UserAvatar
                      name={name}
                      image={member.image}
                      className="size-5"
                      fallbackClassName="text-[10px]"
                    />
                    <span className="flex-1 truncate">{name}</span>
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
