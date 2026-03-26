import { RippleSpinner } from "@/components/RippleSpinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_CATEGORY_LABELS,
  DEFAULT_PREFERENCES,
  type NotificationCategory,
} from "@shared/notificationCategories";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

export function WorkspaceSettings() {
  const { workspaceId } = useParams();
  const id = workspaceId as Id<"workspaces">;
  const workspace = useQuery(api.workspaces.get, { id });
  const updateWorkspace = useMutation(api.workspaces.update);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [descriptionOverride, setDescriptionOverride] = useState<string | null>(null);

  if (workspace === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <RippleSpinner />
      </div>
    );
  }

  if (workspace === null) {
    return <ResourceDeleted resourceType="workspace" />;
  }

  const name = nameOverride ?? workspace.name;
  const description = descriptionOverride ?? workspace.description ?? "";
  const hasChanges = nameOverride !== null || descriptionOverride !== null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateWorkspace({ id, name, description });
      toast.success("Workspace updated");
      setNameOverride(null);
      setDescriptionOverride(null);
    } catch (error) {
      toast.error("Error updating workspace", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl animate-fade-in">
      <h1 className="hidden md:block text-2xl font-bold mb-6">Workspace Settings</h1>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Details</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <Label htmlFor="workspace-name">Workspace Name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(e) => setNameOverride(e.target.value)}
              placeholder="Enter workspace name"
              required
            />
          </div>
          <div>
            <Label htmlFor="workspace-description">Description</Label>
            <Textarea
              id="workspace-description"
              value={description}
              onChange={(e) => setDescriptionOverride(e.target.value)}
              placeholder="Enter workspace description"
              rows={3}
            />
          </div>
          {hasChanges && (
            <Button type="submit">Save Changes</Button>
          )}
        </form>
      </section>

      <Separator className="my-6" />

      <WorkspaceNotificationSettings />
    </div>
  );
}

function WorkspaceNotificationSettings() {
  const prefs = useQuery(api.notificationPreferences.get);
  const savePrefs = useMutation(api.notificationPreferences.save);

  const currentPrefs: Record<NotificationCategory, boolean> = prefs
        ? (Object.fromEntries(
            Object.entries(DEFAULT_PREFERENCES).map(([key]) => [
              key,
              prefs[key as NotificationCategory],
            ]),
          ) as Record<NotificationCategory, boolean>)
        : { ...DEFAULT_PREFERENCES };

  const handleCategoryToggle = (category: NotificationCategory, enabled: boolean) => {
      const updated = { ...currentPrefs, [category]: enabled };
      void savePrefs(updated);
    };

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-4">Notifications</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Configure which workspace notifications you receive. Chat and task notifications are configured in each channel's and project's settings.
      </p>
      <div className="space-y-4">
        {NOTIFICATION_GROUPS.map((group) => (
          <div key={group.label} className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {group.label}
            </p>
            {group.perResource ? (
              <p className="text-sm text-muted-foreground">
                Configured per {group.perResource} in each {group.perResource}'s settings.
              </p>
            ) : (
              <div className="space-y-2">
                {group.categories.map((category) => (
                  <div
                    key={category}
                    className="flex items-center justify-between py-0.5"
                  >
                    <span className="text-sm">
                      {NOTIFICATION_CATEGORY_LABELS[category]}
                    </span>
                    <Switch
                      checked={currentPrefs[category]}
                      onCheckedChange={(checked) =>
                        handleCategoryToggle(category, checked)
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
