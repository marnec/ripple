import { forgetCachedQueries } from "@/lib/query-cache";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ripple/ui/components/select";
import { Button } from "@ripple/ui/components/button";
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useUserSettings } from "@/hooks/use-user-settings";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { Label } from "@/components/ui/label";
import { useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { LogOut, Settings } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { GithubMark } from "@/components/GithubMark";
import { GitlabMark } from "@/components/GitlabMark";
import { useViewer } from "./UserContext";

function describeError(error: unknown): string {
  return error instanceof ConvexError
    ? String(error.data)
    : error instanceof Error
      ? error.message
      : "Please try again.";
}

/**
 * One "Connected accounts" row: the provider mark, then either the connected
 * `@login` with Disconnect, or Connect. Connect starts the provider's
 * authorize round trip and leaves the page; the callback brings the member
 * back to `returnTo` with a `<provider>_identity` flag that the workspace
 * shell toasts.
 *
 * Needs a workspace in the route because the one-time nonce is written
 * against one (the dialog already assumes it for "leave workspace").
 */
function ConnectedAccountRow({
  provider,
  label,
  mark,
  login,
  begin,
  onDisconnect,
}: {
  provider: "github" | "gitlab";
  label: string;
  mark: React.ReactNode;
  login: string | undefined;
  /**
   * Starts the provider's authorize round trip and resolves to the URL to
   * leave for. GitHub starts from a mutation, GitLab (PKCE) from an action,
   * so the row takes the call rather than the reference.
   */
  begin: (returnTo: string) => Promise<{ url: string }>;
  onDisconnect: (provider: "github" | "gitlab") => Promise<null>;
}) {
  const location = useLocation();
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await begin(location.pathname);
      window.location.assign(url);
    } catch (error) {
      toast.error(`Couldn't start connecting ${label}`, {
        description: describeError(error),
      });
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await onDisconnect(provider);
      toast.success(`${label} account disconnected`);
    } catch (error) {
      toast.error(`Couldn't disconnect ${label}`, {
        description: describeError(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <span className="shrink-0 text-muted-foreground">{mark}</span>
        <span className="font-medium">{label}</span>
        {login ? (
          <span className="text-muted-foreground truncate">@{login}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Not connected</span>
        )}
      </div>
      {login ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void disconnect()}>
          Disconnect
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void connect()}>
          Connect
        </Button>
      )}
    </div>
  );
}

export function UserSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [settings, updateSettings] = useUserSettings();
  const pushNotifications = usePushNotifications();
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const leaveWorkspace = useMutation(api.workspaceMembers.leave);
  const viewer = useViewer();
  const beginIdentityConnect = useMutation(
    api.integrations.core.identityConnect.beginIdentityConnect,
  );
  const beginGitlabIdentityConnect = useAction(
    api.integrations.gitlab.identityAction.beginIdentityConnect,
  );
  const disconnectIdentity = useMutation(
    api.integrations.core.identityConnect.disconnectIdentity,
  );

  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const handleLeaveWorkspace = async () => {
    if (!workspaceId) return;
    if (
      !confirm(
        "Leave this workspace? You'll lose access to its channels, documents, and tasks.",
      )
    ) return;

    setLeaving(true);
    try {
      await leaveWorkspace({ workspaceId: workspaceId as Id<"workspaces"> });
      // The answers kept on this device for that workspace — its sidebar, its
      // lists — are no longer ours to show. Every such row names the
      // workspace in its arguments.
      void forgetCachedQueries((key) => key.includes(workspaceId));
      toast.success("You left the workspace");
      onOpenChange(false);
      void navigate("/workspaces");
    } catch (error) {
      toast.error("Could not leave workspace", {
        description:
          error instanceof ConvexError
            ? String(error.data)
            : error instanceof Error
              ? error.message
              : "Please try again.",
      });
    } finally {
      setLeaving(false);
    }
  };

  const notificationsSupported =
    typeof window !== "undefined" && "Notification" in window;
  const permissionDenied = pushNotifications.permission === "denied";

  const handleNotificationsChange = async (enabled: boolean) => {
    setBusy(true);
    try {
      updateSettings({ notificationsEnabled: enabled });
      if (enabled) {
        await pushNotifications.subscribeUser();
      } else {
        await pushNotifications.unsubscribeUser();
      }
    } finally {
      setBusy(false);
    }
  };

  const masterEnabled = settings.notificationsEnabled;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Settings</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-6 max-h-[70vh] overflow-y-auto overflow-x-hidden">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Appearance</Label>
            <ThemeToggle />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  Notifications
                  {notificationsSupported && !permissionDenied && pushNotifications.permission === "default" && (
                    <span className="size-2 rounded-full bg-blue-600" />
                  )}
                </Label>
                {permissionDenied && (
                  <p className="text-xs text-muted-foreground">
                    Blocked by browser. Reset in site settings.
                  </p>
                )}
                {!notificationsSupported && (
                  <p className="text-xs text-muted-foreground">
                    Not supported in this browser.
                  </p>
                )}
              </div>
              <Switch
                checked={settings.notificationsEnabled && !permissionDenied}
                onCheckedChange={(checked) =>
                  void handleNotificationsChange(checked)
                }
                disabled={
                  busy || permissionDenied || !notificationsSupported
                }
              />
            </div>

            {masterEnabled && (
              <button
                type="button"
                disabled={!workspaceId}
                onClick={() => {
                  if (workspaceId) {
                    onOpenChange(false);
                    void navigate(
                      `/workspaces/${workspaceId}/settings?tab=notifications`,
                    );
                  }
                }}
                className={`flex items-center gap-2 text-sm w-full rounded-md px-2 py-2 transition-colors ${
                  workspaceId
                    ? "text-primary hover:bg-accent cursor-pointer"
                    : "text-muted-foreground cursor-not-allowed"
                }`}
              >
                <Settings className="h-4 w-4" />
                {workspaceId
                  ? "Configure notification preferences in workspace settings"
                  : "Select a workspace to configure notification preferences"}
              </button>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Language</Label>
            <Select
              value={settings.language}
              onValueChange={(value) => { if (value !== null) updateSettings({ language: value }); }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {workspaceId && viewer && (
            <div className="space-y-3 border-t pt-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Connected accounts</Label>
                <p className="text-xs text-muted-foreground">
                  Prove which account is yours so linked issues can assign and
                  mention you.
                </p>
              </div>
              <ConnectedAccountRow
                provider="github"
                label="GitHub"
                mark={<GithubMark className="size-4" />}
                login={viewer.githubLogin}
                begin={(returnTo) =>
                  beginIdentityConnect({
                    provider: "github",
                    workspaceId: workspaceId as Id<"workspaces">,
                    returnTo,
                  })
                }
                onDisconnect={(provider) => disconnectIdentity({ provider })}
              />
              <ConnectedAccountRow
                provider="gitlab"
                label="GitLab"
                mark={<GitlabMark className="size-4" />}
                login={viewer.gitlabLogin}
                begin={(returnTo) =>
                  beginGitlabIdentityConnect({
                    workspaceId: workspaceId as Id<"workspaces">,
                    returnTo,
                  })
                }
                onDisconnect={(provider) => disconnectIdentity({ provider })}
              />
            </div>
          )}

          {workspaceId && (
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Workspace</Label>
                  <p className="text-xs text-muted-foreground">
                    Leave this workspace and remove yourself from its channels.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleLeaveWorkspace()}
                  disabled={leaving}
                  className="text-destructive hover:text-destructive"
                >
                  <LogOut className="size-4" />
                  {leaving ? "Leaving..." : "Leave"}
                </Button>
              </div>
            </div>
          )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
