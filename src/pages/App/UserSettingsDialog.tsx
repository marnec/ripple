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
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useUserSettings } from "@/hooks/use-user-settings";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { Label } from "@/components/ui/label";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { LogOut, Settings } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export function UserSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [settings, updateSettings] = useUserSettings();
  const pushNotifications = usePushNotifications();
  const pushRef = useRef(pushNotifications);
  pushRef.current = pushNotifications;
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const leaveWorkspace = useMutation(api.workspaceMembers.leave);

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
        await pushRef.current.subscribeUser();
      } else {
        await pushRef.current.unsubscribeUser();
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
                    void navigate(`/workspaces/${workspaceId}/settings`);
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
