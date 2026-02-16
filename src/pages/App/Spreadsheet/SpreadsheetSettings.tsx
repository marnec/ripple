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
import { SpreadsheetRole } from "@shared/enums";
import { getUserDisplayName } from "@shared/displayName";
import { SpreadsheetMember } from "@shared/types/spreadsheet";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import {
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

type SpreadsheetSettingsContentProps = {
  workspaceId: Id<"workspaces">;
  spreadsheetId: Id<"spreadsheets">;
};

function SpreadsheetSettingsContent({
  workspaceId,
  spreadsheetId,
}: SpreadsheetSettingsContentProps) {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Queries
  const spreadsheet = useQuery(api.spreadsheets.get, { id: spreadsheetId });
  const spreadsheetMembers = useQuery(api.spreadsheetMembers.membersBySpreadsheet, { spreadsheetId });
  const workspaceMembers = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const currentUser = useQuery(api.users.viewer);

  // Mutations
  const renameSpreadsheet = useMutation(api.spreadsheets.rename);
  const deleteSpreadsheet = useMutation(api.spreadsheets.remove);
  const addMember = useMutation(api.spreadsheetMembers.addMember);
  const removeMember = useMutation(api.spreadsheetMembers.removeMember);
  const updateRole = useMutation(api.spreadsheetMembers.updateRole);

  // Local state
  const [spreadsheetName, setSpreadsheetName] = useState<string | null>(null);

  if (
    spreadsheet === undefined ||
    spreadsheetMembers === undefined ||
    workspaceMembers === undefined ||
    currentUser === undefined
  ) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  if (spreadsheet === null || currentUser === null) {
    return <SomethingWentWrong />;
  }

  const displayName = spreadsheetName ?? spreadsheet.name;

  // Determine admin status
  const currentMembership = spreadsheetMembers.find(
    (m) => m.userId === currentUser._id,
  );
  const isAdmin = currentMembership?.role === SpreadsheetRole.ADMIN;

  // Available workspace members not in spreadsheet
  const spreadsheetMemberIds = new Set(spreadsheetMembers.map((m) => m.userId));
  const availableMembers = workspaceMembers.filter(
    (m) => !spreadsheetMemberIds.has(m._id),
  );

  const hasChanges = spreadsheetName !== null;

  const handleSaveDetails = async () => {
    try {
      await renameSpreadsheet({ id: spreadsheetId, name: displayName });
      toast({ title: "Spreadsheet updated" });
      setSpreadsheetName(null);
    } catch (error) {
      toast({
        title: "Error updating spreadsheet",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleAddMember = (userId: Id<"users">) => {
    addMember({ spreadsheetId, userId }).catch((error) => {
      if (error instanceof ConvexError) {
        toast({ title: "Error", description: String(error.data), variant: "destructive" });
      }
    });
  };

  const handleRemoveMember = (userId: Id<"users">) => {
    removeMember({ spreadsheetId, userId }).catch((error) => {
      if (error instanceof ConvexError) {
        toast({ title: "Error", description: String(error.data), variant: "destructive" });
      }
    });
  };

  const handleRoleChange = (
    _memberId: Id<"spreadsheetMembers">,
    userId: Id<"users">,
    role: Values<typeof SpreadsheetRole>,
  ) => {
    updateRole({ spreadsheetId, userId, role }).catch((error) => {
      if (error instanceof ConvexError) {
        toast({ title: "Error", description: String(error.data), variant: "destructive" });
      }
    });
  };

  const handleDeleteSpreadsheet = async () => {
    if (
      !confirm(
        "Are you sure you want to delete this spreadsheet? All content will be permanently lost.",
      )
    ) {
      return;
    }
    try {
      await deleteSpreadsheet({ id: spreadsheetId });
      toast({ title: "Spreadsheet deleted" });
      void navigate(`/workspaces/${workspaceId}/spreadsheets`);
    } catch (error) {
      toast({
        title: "Error deleting spreadsheet",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container mx-auto py-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Spreadsheet Settings</h1>

      {/* Details Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Details</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="spreadsheet-name">Spreadsheet Name</Label>
            <Input
              id="spreadsheet-name"
              value={displayName}
              onChange={(e) => setSpreadsheetName(e.target.value)}
              placeholder="Enter spreadsheet name"
              disabled={!isAdmin}
            />
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

        {/* Add Member */}
        {isAdmin && availableMembers.length > 0 && (
          <AddMemberSelect
            availableMembers={availableMembers}
            onAdd={handleAddMember}
          />
        )}

        {/* Member List */}
        <div className="space-y-2">
          {spreadsheetMembers.map((member) => (
            <MemberRow
              key={member._id}
              member={member}
              isAdmin={isAdmin}
              currentUserId={currentUser._id}
              onRoleChange={handleRoleChange}
              onRemove={handleRemoveMember}
            />
          ))}
          {spreadsheetMembers.length === 0 && (
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
              onClick={() => void handleDeleteSpreadsheet()}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Spreadsheet
            </Button>
            <p className="text-sm text-muted-foreground mt-2">
              This will permanently delete the spreadsheet and all its content.
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
  currentUserId,
  onRoleChange,
  onRemove,
}: {
  member: SpreadsheetMember;
  isAdmin: boolean;
  currentUserId: Id<"users">;
  onRoleChange: (id: Id<"spreadsheetMembers">, userId: Id<"users">, role: Values<typeof SpreadsheetRole>) => void;
  onRemove: (userId: Id<"users">) => void;
}) {
  const isSelf = member.userId === currentUserId;

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border">
      <div className="flex items-center gap-3 min-w-0">
        <User className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">{getUserDisplayName(member.user)}</span>
        {member.role === SpreadsheetRole.ADMIN && (
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
        {/* Role selector — admin only */}
        {isAdmin && (
          <Select
            value={member.role}
            onValueChange={(role: Values<typeof SpreadsheetRole>) =>
              onRoleChange(member._id, member.userId, role)
            }
          >
            <SelectTrigger className="w-27.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SpreadsheetRole).map(([label, value]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Remove button — admin only, can't remove self */}
        {isAdmin && !isSelf && (
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

export const SpreadsheetSettings = () => {
  const { workspaceId, spreadsheetId } = useParams<QueryParams>();

  if (!workspaceId || !spreadsheetId) return <SomethingWentWrong />;

  return (
    <SpreadsheetSettingsContent
      workspaceId={workspaceId}
      spreadsheetId={spreadsheetId}
    />
  );
};
