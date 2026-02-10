import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { ChannelRole } from "@shared/enums";
import { getUserDisplayName } from "@shared/displayName";
import { ChannelMember } from "@shared/types/channel";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import {
  Globe,
  Lock,
  Shield,
  Trash2,
  User,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { Values } from "@shared/types/object";

type ChannelSettingsContentProps = {
  workspaceId: Id<"workspaces">;
  channelId: Id<"channels">;
};

function ChannelSettingsContent({
  workspaceId,
  channelId,
}: ChannelSettingsContentProps) {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Queries
  const channel = useQuery(api.channels.get, { id: channelId });
  const channelMembers = useQuery(api.channelMembers.membersByChannel, { channelId });
  const workspaceMembers = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const currentUser = useQuery(api.users.viewer);

  // Mutations
  const updateChannel = useMutation(api.channels.update);
  const deleteChannel = useMutation(api.channels.remove);
  const addToChannel = useMutation(api.channelMembers.addToChannel);
  const removeFromChannel = useMutation(api.channelMembers.removeFromChannel);
  const changeMemberRole = useMutation(api.channelMembers.changeMemberRole);

  // Local state
  const [channelName, setChannelName] = useState<string | null>(null);

  if (
    channel === undefined ||
    channelMembers === undefined ||
    workspaceMembers === undefined ||
    currentUser === undefined
  ) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  if (channel === null || currentUser === null) {
    return <SomethingWentWrong />;
  }

  const displayName = channelName ?? channel.name;

  // Determine admin status
  const currentMembership = channelMembers.find(
    (m) => m.userId === currentUser._id,
  );
  const isAdmin = channel.isPublic
    ? true // public channels: all workspace members can see, but admin actions checked server-side
    : currentMembership?.role === ChannelRole.ADMIN;

  // Available workspace members not in channel (for private channels)
  const channelMemberIds = new Set(channelMembers.map((m) => m.userId));
  const availableMembers = workspaceMembers.filter(
    (m) => !channelMemberIds.has(m._id),
  );

  const hasChanges = channelName !== null;

  const handleSaveDetails = async () => {
    try {
      await updateChannel({
        id: channelId,
        ...(channelName !== null && { name: channelName }),
      });
      toast({ title: "Channel updated" });
      setChannelName(null);
    } catch (error) {
      toast({
        title: "Error updating channel",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleAddMember = (userId: Id<"users">) => {
    addToChannel({ channelId, userId }).catch((error) => {
      if (error instanceof ConvexError) {
        toast({ title: "Error", description: String(error.data), variant: "destructive" });
      }
    });
  };

  const handleRemoveMember = (userId: Id<"users">) => {
    removeFromChannel({ channelId, userId }).catch((error) => {
      if (error instanceof ConvexError) {
        toast({ title: "Error", description: String(error.data), variant: "destructive" });
      }
    });
  };

  const handleRoleChange = (
    channelMemberId: Id<"channelMembers">,
    role: Values<typeof ChannelRole>,
  ) => {
    changeMemberRole({ channelMemberId, role }).catch((error) => {
      if (error instanceof ConvexError) {
        toast({ title: "Error", description: String(error.data), variant: "destructive" });
      }
    });
  };

  const handleDeleteChannel = async () => {
    if (
      !confirm(
        "Are you sure you want to delete this channel? All messages will be permanently lost.",
      )
    ) {
      return;
    }
    try {
      await deleteChannel({ id: channelId });
      toast({ title: "Channel deleted" });
      void navigate(`/workspaces/${workspaceId}`);
    } catch (error) {
      toast({
        title: "Error deleting channel",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container mx-auto py-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Channel Settings</h1>

      {/* Details Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Details</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="channel-name">Channel Name</Label>
            <Input
              id="channel-name"
              value={displayName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder="Enter channel name"
              disabled={!isAdmin}
            />
          </div>

          <div>
            <Label>Visibility</Label>
            <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
              {channel.isPublic ? (
                <>
                  <Globe className="w-4 h-4" />
                  <span>Public — visible to all workspace members</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Private — only visible to channel members</span>
                </>
              )}
            </div>
          </div>

          {hasChanges && isAdmin && (
            <Button onClick={() => void handleSaveDetails()}>Save Changes</Button>
          )}
        </div>
      </section>

      <Separator className="my-6" />

      {/* Members Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Members</h2>

        {/* Add Member — only for private channels with admin access */}
        {!channel.isPublic && isAdmin && availableMembers.length > 0 && (
          <AddMemberSelect
            availableMembers={availableMembers}
            onAdd={handleAddMember}
          />
        )}

        {channel.isPublic && (
          <p className="text-sm text-muted-foreground mb-4">
            All workspace members have access to this public channel.
          </p>
        )}

        {/* Member List */}
        <div className="space-y-2">
          {channelMembers.map((member) => (
            <MemberRow
              key={member._id}
              member={member}
              isAdmin={isAdmin}
              isPrivate={!channel.isPublic}
              currentUserId={currentUser._id}
              onRoleChange={handleRoleChange}
              onRemove={handleRemoveMember}
            />
          ))}
          {channelMembers.length === 0 && !channel.isPublic && (
            <p className="text-sm text-muted-foreground py-3">
              No members yet. Add members above to get started.
            </p>
          )}
        </div>
      </section>

      {/* Danger Zone — admin only */}
      {isAdmin && (
        <>
          <Separator className="my-6" />

          <section>
            <h2 className="text-lg font-semibold mb-4 text-destructive">
              Danger Zone
            </h2>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteChannel()}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Channel
            </Button>
            <p className="text-sm text-muted-foreground mt-2">
              This will permanently delete the channel and all its messages.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/* ─── Add Member Select ──────────────────────────────────────────── */

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
      <Select value={selectedUserId} onValueChange={setSelectedUserId}>
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

/* ─── Member Row ─────────────────────────────────────────────────── */

function MemberRow({
  member,
  isAdmin,
  isPrivate,
  currentUserId,
  onRoleChange,
  onRemove,
}: {
  member: ChannelMember;
  isAdmin: boolean;
  isPrivate: boolean;
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
        {/* Role selector — admin only, private channels only */}
        {isAdmin && isPrivate && (
          <Select
            value={member.role}
            onValueChange={(role: Values<typeof ChannelRole>) =>
              onRoleChange(member._id, role)
            }
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

        {/* Remove button — admin only, private channels only, can't remove self */}
        {isAdmin && isPrivate && !isSelf && (
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

/* ─── Entry Point ────────────────────────────────────────────────── */

export const ChannelSettings = () => {
  const { workspaceId, channelId } = useParams<QueryParams>();

  if (!workspaceId || !channelId) return <SomethingWentWrong />;

  return (
    <ChannelSettingsContent
      workspaceId={workspaceId}
      channelId={channelId}
    />
  );
};
