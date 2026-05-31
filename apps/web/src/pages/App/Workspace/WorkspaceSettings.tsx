import { RippleSpinner } from "@/components/RippleSpinner";
import {
  SettingsLayout,
  useSettingsSection,
  type SettingsSection,
} from "@/components/SettingsLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_CATEGORY_LABELS,
  DEFAULT_PREFERENCES,
  CATEGORY_CHANNELS,
  isEmailCapableCategory,
  type NotificationCategory,
  type NotificationChannel,
} from "@ripple/shared/notificationCategories";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { Bell, Plug, SlidersHorizontal, Users } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { WorkspaceIntegrationsSection } from "./WorkspaceIntegrationsSection";
import { WorkspaceMembersSection } from "./WorkspaceMembersSection";

const SECTIONS: SettingsSection[] = [
  {
    value: "general",
    label: "General",
    icon: SlidersHorizontal,
    description: "Your workspace name and description.",
  },
  {
    value: "members",
    label: "Members",
    icon: Users,
    description: "Manage who can access this workspace and their roles.",
  },
  {
    value: "integrations",
    label: "Integrations",
    icon: Plug,
    description:
      "Audit and control repositories linked across this workspace. Connect new repositories from a project's settings.",
  },
  {
    value: "notifications",
    label: "Notifications",
    icon: Bell,
    description:
      "Choose which workspace notifications you receive. Chat and task notifications live in each channel's and project's settings.",
  },
];

export function WorkspaceSettings() {
  const { workspaceId } = useParams();
  const id = workspaceId as Id<"workspaces">;
  const workspace = useQuery(api.workspaces.get, { id });
  const updateWorkspace = useMutation(api.workspaces.update);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [descriptionOverride, setDescriptionOverride] = useState<string | null>(null);
  const { active, setActive } = useSettingsSection(SECTIONS);

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
    <>
      <MobileHeaderTitle name={workspace.name} />
      <SettingsLayout
        eyebrow="Workspace"
        sections={SECTIONS}
        active={active}
        onChange={setActive}
      >
        {active.value === "general" && (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace Name</Label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(e) => setNameOverride(e.target.value)}
                placeholder="Enter workspace name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-description">Description</Label>
              <Textarea
                id="workspace-description"
                value={description}
                onChange={(e) => setDescriptionOverride(e.target.value)}
                placeholder="Enter workspace description"
                rows={3}
              />
            </div>
            {hasChanges && <Button type="submit">Save Changes</Button>}
          </form>
        )}

        {active.value === "members" && <WorkspaceMembersSection workspaceId={id} />}

        {active.value === "integrations" && (
          <WorkspaceIntegrationsSection workspaceId={id} />
        )}

        {active.value === "notifications" && <WorkspaceNotificationSettings />}
      </SettingsLayout>
    </>
  );
}

// Stored shape of a single category pref. Matches the schema validator
// (apps/convex/convex/schema.ts notificationPreferences). Boolean is
// the legacy shape (still valid); event categories may store the
// `{ push, email }` object form.
type PrefValue = boolean | { push: boolean; email: boolean } | undefined;

function readChannelOn(
  value: PrefValue,
  channel: NotificationChannel,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") {
    // Legacy bool: gates push only. Email defaults true (the user
    // could not have meaningfully said "no" to email when no email
    // path existed; honour the new opt-out only via explicit object
    // writes).
    return channel === "push" ? value : true;
  }
  return value[channel];
}

function WorkspaceNotificationSettings() {
  const prefs = useQuery(api.notificationPreferences.get);
  const savePrefs = useMutation(api.notificationPreferences.save);

  const handleToggle = (
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: boolean,
  ) => {
    // Build a fresh full prefs payload — `save` replaces the row.
    // Categories without an existing row default to DEFAULT_PREFERENCES.
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_PREFERENCES) as NotificationCategory[]) {
      const cur: PrefValue = prefs ? (prefs as unknown as Record<string, PrefValue>)[key] : undefined;
      const fallback = DEFAULT_PREFERENCES[key];
      if (isEmailCapableCategory(key)) {
        // Always serialize as the object shape so the row normalizes
        // away from the legacy boolean after a single save.
        const pushOn = readChannelOn(cur, "push", fallback);
        const emailOn = readChannelOn(cur, "email", fallback);
        if (key === category) {
          next[key] = {
            push: channel === "push" ? enabled : pushOn,
            email: channel === "email" ? enabled : emailOn,
          };
        } else {
          next[key] = { push: pushOn, email: emailOn };
        }
      } else {
        // Flat-bool categories — still toggled via the push column only.
        const value = readChannelOn(cur, "push", fallback);
        next[key] = key === category ? enabled : value;
      }
    }
    void savePrefs(next as Parameters<typeof savePrefs>[0]);
  };

  const getChannelOn = (
    category: NotificationCategory,
    channel: NotificationChannel,
  ): boolean => {
    const cur: PrefValue = prefs ? (prefs as unknown as Record<string, PrefValue>)[category] : undefined;
    return readChannelOn(cur, channel, DEFAULT_PREFERENCES[category]);
  };

  return (
    <div className="space-y-4">
      {NOTIFICATION_GROUPS.map((group) => {
          // A group renders the Email column only when at least one of
          // its categories actually supports email (today: Calendar).
          // Other groups stay single-column to match the existing
          // Channel/Project settings layout.
          const showEmailColumn = group.categories.some((c) =>
            CATEGORY_CHANNELS[c].includes("email"),
          );
          return (
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
                  {showEmailColumn && (
                    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 pb-1 border-b">
                      <span />
                      <span className="text-xs font-medium text-muted-foreground w-12 text-center">
                        Push
                      </span>
                      <span className="text-xs font-medium text-muted-foreground w-12 text-center">
                        Email
                      </span>
                    </div>
                  )}
                  {group.categories.map((category) => {
                    const supportsEmail = CATEGORY_CHANNELS[category].includes("email");
                    if (showEmailColumn) {
                      return (
                        <div
                          key={category}
                          className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 py-0.5"
                        >
                          <span className="text-sm">
                            {NOTIFICATION_CATEGORY_LABELS[category]}
                          </span>
                          <div className="w-12 flex justify-center">
                            <Switch
                              checked={getChannelOn(category, "push")}
                              onCheckedChange={(checked) =>
                                handleToggle(category, "push", checked)
                              }
                              aria-label={`${NOTIFICATION_CATEGORY_LABELS[category]} — push`}
                            />
                          </div>
                          <div className="w-12 flex justify-center">
                            {supportsEmail ? (
                              <Switch
                                checked={getChannelOn(category, "email")}
                                onCheckedChange={(checked) =>
                                  handleToggle(category, "email", checked)
                                }
                                aria-label={`${NOTIFICATION_CATEGORY_LABELS[category]} — email`}
                              />
                            ) : (
                              <span
                                className="text-xs text-muted-foreground"
                                aria-hidden="true"
                              >
                                —
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={category}
                        className="flex items-center justify-between py-0.5"
                      >
                        <span className="text-sm">
                          {NOTIFICATION_CATEGORY_LABELS[category]}
                        </span>
                        <Switch
                          checked={getChannelOn(category, "push")}
                          onCheckedChange={(checked) =>
                            handleToggle(category, "push", checked)
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
