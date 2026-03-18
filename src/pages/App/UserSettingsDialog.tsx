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
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useUserSettings } from "@/hooks/use-user-settings";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { Label } from "@/components/ui/label";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Settings } from "lucide-react";

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

  const [busy, setBusy] = useState(false);

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
                <Label className="text-sm font-medium">Notifications</Label>
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
                checked={settings.notificationsEnabled}
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
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
