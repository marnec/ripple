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
import { DiagramRole } from "@shared/enums";
import { getUserDisplayName } from "@shared/displayName";
import { DiagramMember } from "@shared/types/diagram";
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

type DiagramSettingsContentProps = {
  workspaceId: Id<"workspaces">;
  diagramId: Id<"diagrams">;
};

function DiagramSettingsContent({
  workspaceId,
  diagramId,
}: DiagramSettingsContentProps) {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Queries
  const diagram = useQuery(api.diagrams.get, { id: diagramId });
  const diagramMembers = useQuery(api.diagramMembers.membersByDiagram, { diagramId });
  const workspaceMembers = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const currentUser = useQuery(api.users.viewer);

  // Mutations
  const renameDiagram = useMutation(api.diagrams.rename);
  const deleteDiagram = useMutation(api.diagrams.remove);
  const addMember = useMutation(api.diagramMembers.addMember);
  const removeMember = useMutation(api.diagramMembers.removeMember);
  const updateRole = useMutation(api.diagramMembers.updateRole);

  // Local state
  const [diagramName, setDiagramName] = useState<string | null>(null);

  if (
    diagram === undefined ||
    diagramMembers === undefined ||
    workspaceMembers === undefined ||
    currentUser === undefined
  ) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  if (diagram === null || currentUser === null) {
    return <SomethingWentWrong />;
  }

  const displayName = diagramName ?? diagram.name;

  // Determine admin status
  const currentMembership = diagramMembers.find(
    (m) => m.userId === currentUser._id,
  );
  const isAdmin = currentMembership?.role === DiagramRole.ADMIN;

  // Available workspace members not in diagram
  const diagramMemberIds = new Set(diagramMembers.map((m) => m.userId));
  const availableMembers = workspaceMembers.filter(
    (m) => !diagramMemberIds.has(m._id),
  );

  const hasChanges = diagramName !== null;

  const handleSaveDetails = async () => {
    try {
      await renameDiagram({ id: diagramId, name: displayName });
      toast({ title: "Diagram updated" });
      setDiagramName(null);
    } catch (error) {
      toast({
        title: "Error updating diagram",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleAddMember = (userId: Id<"users">) => {
    addMember({ diagramId, userId }).catch((error) => {
      if (error instanceof ConvexError) {
        toast({ title: "Error", description: String(error.data), variant: "destructive" });
      }
    });
  };

  const handleRemoveMember = (userId: Id<"users">) => {
    removeMember({ diagramId, userId }).catch((error) => {
      if (error instanceof ConvexError) {
        toast({ title: "Error", description: String(error.data), variant: "destructive" });
      }
    });
  };

  const handleRoleChange = (
    _memberId: Id<"diagramMembers">,
    userId: Id<"users">,
    role: Values<typeof DiagramRole>,
  ) => {
    updateRole({ diagramId, userId, role }).catch((error) => {
      if (error instanceof ConvexError) {
        toast({ title: "Error", description: String(error.data), variant: "destructive" });
      }
    });
  };

  const handleDeleteDiagram = async () => {
    if (
      !confirm(
        "Are you sure you want to delete this diagram? All content will be permanently lost.",
      )
    ) {
      return;
    }
    try {
      await deleteDiagram({ id: diagramId });
      toast({ title: "Diagram deleted" });
      void navigate(`/workspaces/${workspaceId}/diagrams`);
    } catch (error) {
      toast({
        title: "Error deleting diagram",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container mx-auto py-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Diagram Settings</h1>

      {/* Details Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Details</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="diagram-name">Diagram Name</Label>
            <Input
              id="diagram-name"
              value={displayName}
              onChange={(e) => setDiagramName(e.target.value)}
              placeholder="Enter diagram name"
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
          {diagramMembers.map((member) => (
            <MemberRow
              key={member._id}
              member={member}
              isAdmin={isAdmin}
              currentUserId={currentUser._id}
              onRoleChange={handleRoleChange}
              onRemove={handleRemoveMember}
            />
          ))}
          {diagramMembers.length === 0 && (
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
              onClick={() => void handleDeleteDiagram()}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Diagram
            </Button>
            <p className="text-sm text-muted-foreground mt-2">
              This will permanently delete the diagram and all its content.
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
  member: DiagramMember;
  isAdmin: boolean;
  currentUserId: Id<"users">;
  onRoleChange: (id: Id<"diagramMembers">, userId: Id<"users">, role: Values<typeof DiagramRole>) => void;
  onRemove: (userId: Id<"users">) => void;
}) {
  const isSelf = member.userId === currentUserId;

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border">
      <div className="flex items-center gap-3 min-w-0">
        <User className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">{getUserDisplayName(member.user)}</span>
        {member.role === DiagramRole.ADMIN && (
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
            onValueChange={(role: Values<typeof DiagramRole>) =>
              onRoleChange(member._id, member.userId, role)
            }
          >
            <SelectTrigger className="w-27.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DiagramRole).map(([label, value]) => (
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

export const DiagramSettings = () => {
  const { workspaceId, diagramId } = useParams<QueryParams>();

  if (!workspaceId || !diagramId) return <SomethingWentWrong />;

  return (
    <DiagramSettingsContent
      workspaceId={workspaceId}
      diagramId={diagramId}
    />
  );
};
