import { UserContext } from "@/pages/App/UserContext";
import {
  ResponsiveDropdownMenu as DropdownMenu,
  ResponsiveDropdownMenuContent as DropdownMenuContent,
  ResponsiveDropdownMenuGroup as DropdownMenuGroup,
  ResponsiveDropdownMenuItem as DropdownMenuItem,
  ResponsiveDropdownMenuLabel as DropdownMenuLabel,
  ResponsiveDropdownMenuSeparator as DropdownMenuSeparator,
  ResponsiveDropdownMenuTrigger as DropdownMenuTrigger,
} from "@/components/ui/responsive-dropdown-menu";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  BadgeCheck,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Mail,
  Download,
  RefreshCw,
  Settings,
  Sparkles,
} from "lucide-react";
import { useContext, useState, type ReactNode } from "react";
import { usePwaUpdate } from "@/hooks/use-pwa-update";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { PendingInvitesDialog } from "./Workspace/PendingInvites";
import { UserSettingsDialog } from "./UserSettingsDialog";
import { usePendingInvites } from "@/hooks/use-pending-invites";
import { Badge } from "../../components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../../components/ui/sidebar";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";


export function NavUser() {
  const user = useContext(UserContext);
  const { signOut } = useAuthActions();
  const [showInvites, setShowInvites] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [menuOpened, setMenuOpened] = useState(false);
  const pendingInvites = usePendingInvites(menuOpened);
  const { needRefresh, updateAndReload } = usePwaUpdate();
  const convexHasUpdate = useVersionCheck();
  const hasUpdate = needRefresh || convexHasUpdate;
  const { canInstall, isIOSSafari, promptInstall } = useInstallPrompt();
  const [showIOSInstall, setShowIOSInstall] = useState(false);
  const [installDotDismissed, setInstallDotDismissed] = useState(
    () => localStorage.getItem("ripple:install-dot-seen") === "1",
  );
  const dismissInstallDot = () => {
    localStorage.setItem("ripple:install-dot-seen", "1");
    setInstallDotDismissed(true);
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu onOpenChange={(open) => { if (open) setMenuOpened(true); }}>
          <DropdownMenuTrigger
            render={<SidebarMenuButton
              size="lg"
              className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
            />}
          >
              <div className="relative">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage
                    src={user?.image || undefined}
                    alt={user?.name || ""}
                  />
                  <AvatarFallback className="rounded-lg">CN</AvatarFallback>
                </Avatar>
                {(hasUpdate || (canInstall && !installDotDismissed) || pendingInvites.length > 0) && (
                  <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-blue-600 ring-2 ring-sidebar" />
                )}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user?.name}</span>
                <span className="truncate text-xs">{user?.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side="right"
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage
                      src={user?.image || undefined}
                      alt={user?.name || ""}
                    />
                    <AvatarFallback className="rounded-lg">CN</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{user?.name}</span>
                    <span className="truncate text-xs">{user?.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Sparkles />
                Upgrade to Pro
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <BadgeCheck />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CreditCard />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowSettings(true)}>
                <Settings />
                Settings
              </DropdownMenuItem>
              {canInstall && (
                <DropdownMenuItem onSelect={() => { dismissInstallDot(); if (isIOSSafari) { setShowIOSInstall(true); } else { void promptInstall(); } }}>
                  <Download />
                  Install app
                  {!installDotDismissed && (
                    <Badge className="ml-auto h-5 min-w-5 justify-center rounded-full bg-blue-600 px-1.5 text-[10px]">
                      1
                    </Badge>
                  )}
                </DropdownMenuItem>
              )}
              {hasUpdate && (
                <DropdownMenuItem onSelect={needRefresh ? updateAndReload : () => window.location.reload()}>
                  <RefreshCw />
                  Update available
                  <Badge className="ml-auto h-5 min-w-5 justify-center rounded-full bg-blue-600 px-1.5 text-[10px]">
                    1
                  </Badge>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setShowInvites(true)}>
                <Mail />
                Invitations
                {pendingInvites.length > 0 && (
                  <Badge className="ml-auto h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px]">
                    {pendingInvites.length}
                  </Badge>
                )}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <PendingInvitesDialog open={showInvites} onOpenChange={setShowInvites} />
      <UserSettingsDialog open={showSettings} onOpenChange={setShowSettings} />
      <IOSInstallDialog open={showIOSInstall} onOpenChange={setShowIOSInstall} />
    </SidebarMenu>
  );
}

function IOSShareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M7 8l5-5 5 5" />
      <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}

function IOSInstallStep({ step, icon, children }: { step: number; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
        {step}
      </div>
      <div className="flex items-center gap-2 pt-0.5 text-sm">
        {icon}
        <span>{children}</span>
      </div>
    </div>
  );
}

function IOSInstallDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Install Ripple</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Add Ripple to your home screen for the best experience.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex flex-col gap-4 px-4 pb-6 pt-2">
          <IOSInstallStep step={1} icon={<IOSShareIcon className="size-5 text-blue-500" />}>
            Tap the <span className="font-medium">Share</span> button in Safari's toolbar
          </IOSInstallStep>
          <IOSInstallStep step={2} icon={<span className="text-base">+</span>}>
            Scroll down and tap <span className="font-medium">Add to Home Screen</span>
          </IOSInstallStep>
          <IOSInstallStep step={3} icon={null}>
            Tap <span className="font-medium">Add</span> to confirm
          </IOSInstallStep>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
