import { RippleSpinner } from "@/components/RippleSpinner";
import { TagInput } from "@/components/TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@shared/types/routes";
import {
  TASK_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  DEFAULT_PROJECT_TASK_PREFERENCES,
  type TaskNotificationCategory,
} from "@shared/notificationCategories";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { useViewer } from "../UserContext";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

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
  // Queries
  const project = useQuery(api.projects.get, { id: projectId });
  const currentUser = useViewer();
  const projectHasTasks = useQuery(api.tasks.hasAnyTasks, { projectId });

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
        <RippleSpinner />
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
      toast.success("Project updated");
      setProjectName(null);
      setSelectedColor(null);
      setProjectKey(null);
    } catch (error) {
      toast.error("Error updating project", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  const handleDeleteProject = async () => {
    if (!confirm("Are you sure you want to delete this project? This cannot be undone.")) {
      return;
    }
    try {
      await deleteProject({ id: projectId });
      toast.success("Project deleted");
      void navigate(`/workspaces/${workspaceId}/projects`);
    } catch (error) {
      toast.error("Error deleting project", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  const hasChanges = projectName !== null || selectedColor !== null || projectKey !== null;

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl animate-fade-in">
      <h1 className="hidden md:block text-2xl font-bold mb-6">Project Settings</h1>

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
              disabled={!isCreator || !!projectHasTasks}
              maxLength={5}
              className="font-mono uppercase"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {projectHasTasks
                ? "The project key cannot be changed once tasks have been created."
                : `2-5 character identifier used in task IDs (e.g., ${displayKey || "ENG"}-1). Cannot be changed once tasks exist.`}
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

      {/* Tags Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Tags</h2>
        <TagInput
          value={project.tags ?? []}
          onChange={(tags) => void updateProject({ id: projectId, tags })}
          workspaceId={workspaceId}
          placeholder="Add tags to organize this project..."
        />
      </section>

      {/* Notifications Section - visible to all users */}
      <ProjectNotificationSettings projectId={projectId} />

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

function ProjectNotificationSettings({ projectId }: { projectId: Id<"projects"> }) {
  const projNotifPrefs = useQuery(api.projectNotificationPreferences.get, { projectId });
  const savePrefs = useMutation(api.projectNotificationPreferences.save);

  const currentPrefs: Record<TaskNotificationCategory, boolean> = (() => {
    if (!projNotifPrefs) return { ...DEFAULT_PROJECT_TASK_PREFERENCES };
    return Object.fromEntries(
      TASK_NOTIFICATION_CATEGORIES.map((cat) => [cat, projNotifPrefs[cat]]),
    ) as Record<TaskNotificationCategory, boolean>;
  })();

  const handleToggle = (category: TaskNotificationCategory, enabled: boolean) => {
      const updated = { ...currentPrefs, [category]: enabled, projectId };
      // Turning on "comments on assigned tasks" also enables "mentioned in task comment"
      if (category === "taskComment" && enabled) {
        updated.taskCommentMention = true;
      }
      void savePrefs(updated);
    };

  return (
    <>
      <Separator className="my-6" />
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Notifications</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Control which task notifications you receive for this project.
        </p>
        <div className="space-y-2">
          {TASK_NOTIFICATION_CATEGORIES.map((category) => {
            const lockedOn = category === "taskCommentMention" && currentPrefs.taskComment;
            return (
              <div
                key={category}
                className="flex items-center justify-between py-0.5"
              >
                <span className={`text-sm ${lockedOn ? "text-muted-foreground" : ""}`}>
                  {NOTIFICATION_CATEGORY_LABELS[category]}
                </span>
                <Switch
                  checked={currentPrefs[category]}
                  disabled={lockedOn}
                  onCheckedChange={(checked) => handleToggle(category, checked)}
                />
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
