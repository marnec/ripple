import { DocumentRole } from "@shared/enums";
import { DocumentMember } from "@shared/types/document";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Values } from "@shared/types/object";
import { User } from "lucide-react";

type DocumentMembershipRoleProps = {
  documentMembers: DocumentMember[];
};

export const DocumentMembershipRole = ({ documentMembers }: DocumentMembershipRoleProps) => {
  const updateRole = useMutation(api.documentMembers.updateRole);

  const handleRoleSelection = (
    documentId: Id<"documents">,
    userId: Id<"users">,
    role: Values<typeof DocumentRole>,
  ) => {
    void updateRole({ documentId, userId, role });
  };

  return (
    <>
      {documentMembers.map((member) => (
        <div
          key={member.userId}
          className="flex flex-row items-center justify-between w-full sm:w-1/2"
        >
          <div className="flex items-center gap-3 truncate ">
            <User className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground truncate">
              {member.user.name || member.user.email}
            </span>
          </div>

          <div>
            <Select
              onValueChange={(role: Values<typeof DocumentRole>) =>
                handleRoleSelection(member.documentId, member.userId, role)
              }
              defaultValue={member.role}
              value={member.role}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>

              <SelectContent>
                {Object.entries(DocumentRole).map(([roleName, roleValue]) => (
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