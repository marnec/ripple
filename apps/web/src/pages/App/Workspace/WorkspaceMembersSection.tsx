import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useViewer } from "../UserContext";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { ConvexError } from "convex/values";
import { Shield, User, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export function WorkspaceMembersSection({
  workspaceId,
}: {
  workspaceId: Id<"workspaces">;
}) {
  const members = useQuery(api.workspaceMembers.membersWithRoles, { workspaceId });
  const currentUser = useViewer();
  const changeRole = useMutation(api.workspaceMembers.changeRole);
  const removeMember = useMutation(api.workspaceMembers.remove);

  if (!members || currentUser === undefined) return null;

  const currentMembership = members.find((m) => m.userId === currentUser?._id);
  const isAdmin = currentMembership?.role === "admin";

  const handleRoleChange = (targetUserId: Id<"users">, role: "admin" | "member") => {
    changeRole({ workspaceId, targetUserId, role }).catch((error) => {
      if (error instanceof ConvexError) {
        toast.error("Error", { description: String(error.data) });
      }
    });
  };

  const handleRemove = (targetUserId: Id<"users">, name: string) => {
    if (!confirm(`Are you sure you want to remove ${name} from this workspace? They will lose access to all channels and resources.`)) {
      return;
    }
    removeMember({ workspaceId, targetUserId })
      .then(() => toast.success(`${name} has been removed from the workspace`))
      .catch((error) => {
        if (error instanceof ConvexError) {
          toast.error("Error", { description: String(error.data) });
        }
      });
  };

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-4">Members</h2>
      <div className="space-y-2">
        {members.map((member) => {
          const isSelf = member.userId === currentUser?._id;
          return (
            <div
              key={member.membershipId}
              className="flex items-center justify-between p-3 rounded-lg border"
            >
              <div className="flex items-center gap-3 min-w-0">
                <User className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="font-medium truncate">{member.name}</span>
                {member.role === "admin" && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                    <Shield className="w-3 h-3" />
                    Admin
                  </span>
                )}
                {isSelf && (
                  <span className="text-xs text-muted-foreground shrink-0">(you)</span>
                )}
              </div>

              {isAdmin && !isSelf && (
                <div className="flex items-center gap-2 shrink-0">
                  <Select
                    value={member.role}
                    onValueChange={(role) =>
                      handleRoleChange(member.userId, role as "admin" | "member")
                    }
                  >
                    <SelectTrigger className="w-27.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(member.userId, member.name)}
                  >
                    <UserMinus className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
