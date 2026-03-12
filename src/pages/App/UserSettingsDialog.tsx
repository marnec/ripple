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
import { useCallback, useRef, useState } from "react";

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

  const [busy, setBusy] = useState(false);

  const notificationsSupported =
    typeof window !== "undefined" && "Notification" in window;
  const permissionDenied = pushNotifications.permission === "denied";

  const handleNotificationsChange = useCallback(
    async (enabled: boolean) => {
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
    },
    [updateSettings],
  );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Settings</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-6">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Appearance</Label>
            <ThemeToggle />
          </div>

          <div className="space-y-2">
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
