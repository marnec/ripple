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
import { useMutation, useQuery } from "convex/react";
import { Trash2, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

const PROJECT_COLORS = [
  { name: "Blue", class: "bg-blue-500" },
  { name: "Green", class: "bg-green-500" },
  { name: "Yellow", class: "bg-yellow-500" },
  { name: "Red", class: "bg-red-500" },
  { name: "Purple", class: "bg-purple-500" },
  { name: "Pink", class: "bg-pink-500" },
  { name: "Orange", class: "bg-orange-500" },
  { name: "Teal", class: "bg-teal-500" },
];

export function ProjectSettings() {
  const { workspaceId, projectId } = useParams<QueryParams>();

  if (!workspaceId || !projectId) {
    return <SomethingWentWrong />;
  }

  return (
    <ProjectSettingsContent
      workspaceId={workspaceId}
      projectId={projectId}
    />
  );
}

function ProjectSettingsContent({
  workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Queries
  const project = useQuery(api.projects.get, { id: projectId });
  const projectMembers = useQuery(api.projectMembers.membersByProject, { projectId });
  const workspaceMembers = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const currentUser = useQuery(api.users.viewer);

  // Mutations
  const updateProject = useMutation(api.projects.update);
  const deleteProject = useMutation(api.projects.remove);
  const addMember = useMutation(api.projectMembers.addToProject);
  const removeMember = useMutation(api.projectMembers.removeFromProject);

  // Local state
  const [projectName, setProjectName] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  if (project === undefined || projectMembers === undefined || workspaceMembers === undefined || currentUser === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  if (project === null || currentUser === null) {
    return <SomethingWentWrong />;
  }

  const displayName = projectName ?? project.name;
  const displayColor = selectedColor ?? project.color;

  // Check if current user is the project creator (admin)
  const isCreator = currentUser._id === project.creatorId;

  // Find workspace members not in project (for add dropdown)
  // workspaceMembers returns user objects where _id is the user's _id
  const projectMemberIds = new Set(projectMembers.map((m) => m.userId));
  const availableMembers = workspaceMembers.filter((m) => !projectMemberIds.has(m._id));

  const handleSaveDetails = async () => {
    try {
      await updateProject({
        id: projectId,
        ...(projectName !== null && { name: projectName }),
        ...(selectedColor !== null && { color: selectedColor }),
      });
      toast({ title: "Project updated" });
      setProjectName(null);
      setSelectedColor(null);
    } catch (error) {
      toast({
        title: "Error updating project",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleAddMember = async () => {
    if (!selectedUserId) return;
    try {
      await addMember({
        userId: selectedUserId as Id<"users">,
        projectId,
      });
      toast({ title: "Member added" });
      setSelectedUserId("");
    } catch (error) {
      toast({
        title: "Error adding member",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleRemoveMember = async (userId: Id<"users">) => {
    try {
      await removeMember({ userId, projectId });
      toast({ title: "Member removed" });
    } catch (error) {
      toast({
        title: "Error removing member",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleDeleteProject = async () => {
    if (!confirm("Are you sure you want to delete this project? This cannot be undone.")) {
      return;
    }
    try {
      await deleteProject({ id: projectId });
      toast({ title: "Project deleted" });
      navigate(`/workspaces/${workspaceId}/projects`);
    } catch (error) {
      toast({
        title: "Error deleting project",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const hasChanges = projectName !== null || selectedColor !== null;

  return (
    <div className="container mx-auto py-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Project Settings</h1>

      {/* Project Details Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Details</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="project-name">Project Name</Label>
            <Input
              id="project-name"
              value={displayName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Enter project name"
              disabled={!isCreator}
            />
          </div>
          <div>
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {PROJECT_COLORS.map((color) => (
                <button
                  key={color.class}
                  type="button"
                  onClick={() => isCreator && setSelectedColor(color.class)}
                  disabled={!isCreator}
                  className={`w-8 h-8 rounded-full ${color.class} ${
                    displayColor === color.class
                      ? "ring-2 ring-offset-2 ring-primary"
                      : ""
                  } ${!isCreator ? "opacity-50 cursor-not-allowed" : ""}`}
                  title={color.name}
                />
              ))}
            </div>
          </div>
          {hasChanges && isCreator && (
            <Button onClick={() => void handleSaveDetails()}>Save Changes</Button>
          )}
        </div>
      </section>

      <Separator className="my-6" />

      {/* Members Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Members</h2>

        {/* Add Member - only visible to creator */}
        {isCreator && availableMembers.length > 0 && (
          <div className="flex gap-2 mb-4">
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select a member to add" />
              </SelectTrigger>
              <SelectContent>
                {availableMembers.map((member) => (
                  <SelectItem key={member._id} value={member._id}>
                    {member.name ?? member.email ?? "Unknown user"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => void handleAddMember()} disabled={!selectedUserId}>
              <UserPlus className="w-4 h-4 mr-2" />
              Add
            </Button>
          </div>
        )}

        {/* Member List */}
        <div className="space-y-2">
          {projectMembers.map((member) => {
            // Determine if remove button should be shown:
            // 1. Current user must be the creator (admin)
            // 2. Cannot remove the creator (they must delete the project)
            // 3. Cannot remove yourself (members cannot remove themselves per CONTEXT.md)
            const canRemove = isCreator && !member.isCreator && member.userId !== currentUser._id;

            return (
              <div
                key={member._id}
                className="flex items-center justify-between p-3 rounded-lg border"
              >
                <div>
                  <span className="font-medium">{member.name}</span>
                  {member.isCreator && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      Creator
                    </span>
                  )}
                </div>
                {canRemove && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleRemoveMember(member.userId)}
                  >
                    <UserMinus className="w-4 h-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Danger Zone - only visible to creator */}
      {isCreator && (
        <>
          <Separator className="my-6" />

          <section>
            <h2 className="text-lg font-semibold mb-4 text-destructive">Danger Zone</h2>
            <Button variant="destructive" onClick={() => void handleDeleteProject()}>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Project
            </Button>
            <p className="text-sm text-muted-foreground mt-2">
              This will permanently delete the project and its linked discussion channel.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
