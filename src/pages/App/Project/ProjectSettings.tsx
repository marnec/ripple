import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useMutation, useQuery } from "convex/react";
import { Trash2 } from "lucide-react";
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
  const currentUser = useQuery(api.users.viewer);

  // Mutations
  const updateProject = useMutation(api.projects.update);
  const deleteProject = useMutation(api.projects.remove);

  // Local state
  const [projectName, setProjectName] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [projectKey, setProjectKey] = useState<string | null>(null);

  if (project === undefined || currentUser === undefined) {
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
  const displayKey = projectKey ?? project.key ?? "";

  // Check if current user is the project creator (admin)
  const isCreator = currentUser._id === project.creatorId;

  const handleSaveDetails = async () => {
    try {
      await updateProject({
        id: projectId,
        ...(projectName !== null && { name: projectName }),
        ...(selectedColor !== null && { color: selectedColor }),
        ...(projectKey !== null && { key: projectKey }),
      });
      toast({ title: "Project updated" });
      setProjectName(null);
      setSelectedColor(null);
      setProjectKey(null);
    } catch (error) {
      toast({
        title: "Error updating project",
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
      void navigate(`/workspaces/${workspaceId}/projects`);
    } catch (error) {
      toast({
        title: "Error deleting project",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const hasChanges = projectName !== null || selectedColor !== null || projectKey !== null;

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
            <Label htmlFor="project-key">Project Key</Label>
            <Input
              id="project-key"
              value={displayKey}
              onChange={(e) => setProjectKey(e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 5))}
              placeholder="e.g., ENG"
              disabled={!isCreator}
              maxLength={5}
              className="font-mono uppercase"
            />
            <p className="text-xs text-muted-foreground mt-1">
              2-5 character identifier used in task IDs (e.g., {displayKey || "ENG"}-1)
            </p>
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
              This will permanently delete the project and all its tasks.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
