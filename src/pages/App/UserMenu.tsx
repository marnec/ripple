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
  RefreshCw,
  Settings,
  Sparkles,
} from "lucide-react";
import { useContext, useState } from "react";
import { usePwaUpdate } from "@/hooks/use-pwa-update";
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


export function NavUser() {
  const user = useContext(UserContext);
  const { signOut } = useAuthActions();
  const [showInvites, setShowInvites] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const pendingInvites = usePendingInvites();
  const { needRefresh, updateAndReload } = usePwaUpdate();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
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
                {(needRefresh || pendingInvites.length > 0) && (
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
              {needRefresh && (
                <DropdownMenuItem onSelect={updateAndReload}>
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
    </SidebarMenu>
  );
}
