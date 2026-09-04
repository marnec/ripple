import { useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { ConvexError } from "convex/values";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  MemberCount,
  MemberList,
  MemberListEmpty,
  MemberListItem,
  MemberListPlaceholder,
  MemberRoleBadge,
  MemberRoleSelect,
  MemberSearchInput,
  RemoveMemberButton,
} from "@/components/MemberList";
import { byRoleThenName, matchesMemberQuery } from "@/lib/member-list";
import { missingIdentityHints } from "@/lib/member-identity-hints";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useViewer } from "../UserContext";

/** Above this, scanning the list beats reading it, so the filter appears. */
const SEARCH_THRESHOLD = 8;

const SYNC_HINT_TITLE =
  "Assignee sync skips members who have not connected their account. They can connect it from their user settings.";

export function WorkspaceMembersSection({
  workspaceId,
}: {
  workspaceId: Id<"workspaces">;
}) {
  const members = useQuery(api.workspaceMembers.membersWithRoles, { workspaceId });
  // Which providers the workspace has an installation for — a member without
  // an identity for one of those is who assignee sync silently skips.
  const installations = useQuery(api.integrations.core.install.listInstallations, {
    workspaceId,
  });
  const currentUser = useViewer();
  const changeRole = useMutation(api.workspaceMembers.changeRole);
  const removeMember = useMutation(api.workspaceMembers.remove);

  const [query, setQuery] = useState("");
  // The member awaiting Remove confirmation (null = dialog closed).
  const [removeTarget, setRemoveTarget] = useState<{
    userId: Id<"users">;
    name: string;
  } | null>(null);

  if (members === undefined || currentUser === undefined) {
    return <MemberListPlaceholder />;
  }

  const currentMembership = members.find((m) => m.userId === currentUser?._id);
  const isAdmin = currentMembership?.role === "admin";
  const activeProviders = (installations ?? []).map((i) => i.provider);

  const visible = members
    .filter((member) => matchesMemberQuery(member, query))
    .sort(byRoleThenName);

  const handleRoleChange = (targetUserId: Id<"users">, role: "admin" | "member") => {
    changeRole({ workspaceId, targetUserId, role }).catch((error) => {
      if (error instanceof ConvexError) {
        toast.error("Error", { description: String(error.data) });
      }
    });
  };

  const confirmRemove = () => {
    if (!removeTarget) return;
    const { userId, name } = removeTarget;
    setRemoveTarget(null);
    removeMember({ workspaceId, targetUserId: userId })
      .then(() => toast.success(`${name} has been removed from the workspace`))
      .catch((error) => {
        if (error instanceof ConvexError) {
          toast.error("Error", { description: String(error.data) });
        }
      });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MemberCount shown={visible.length} total={members.length} />
        {members.length > SEARCH_THRESHOLD && (
          <MemberSearchInput value={query} onChange={setQuery} />
        )}
      </div>

      <MemberList>
        {visible.map((member) => {
          const isSelf = member.userId === currentUser?._id;
          return (
            <MemberListItem
              key={member.membershipId}
              name={member.name}
              email={member.email}
              image={member.image}
              isSelf={isSelf}
              hints={missingIdentityHints(member, activeProviders).map((label) => ({
                label,
                title: SYNC_HINT_TITLE,
              }))}
            >
              {isAdmin && !isSelf ? (
                <>
                  <MemberRoleSelect
                    value={member.role}
                    memberName={member.name}
                    onValueChange={(role) => handleRoleChange(member.userId, role)}
                  />
                  <RemoveMemberButton
                    memberName={member.name}
                    onClick={() =>
                      setRemoveTarget({ userId: member.userId, name: member.name })
                    }
                  />
                </>
              ) : (
                <MemberRoleBadge role={member.role} />
              )}
            </MemberListItem>
          );
        })}

        {visible.length === 0 && (
          <MemberListEmpty>No members match “{query}”.</MemberListEmpty>
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
              this workspace? They will lose access to all its channels and
              resources. You can invite them again later.
            </>
          )
        }
        confirmLabel="Remove"
      />
    </div>
  );
}
