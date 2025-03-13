"use client";

import { ChevronsUpDown, Plus, UserPlus } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useState } from "react";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { InviteUserDialog } from "./InviteUserDialog";

export interface WorkspaceSwitcherProps {
  workspaces: Doc<"workspaces">[];
  activeWorkspace: Doc<"workspaces"> | undefined;
  handleWorkspaceSelect: (id: Id<"workspaces">) => void;
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspace,
  handleWorkspaceSelect,
}: WorkspaceSwitcherProps) {
  const { isMobile } = useSidebar();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {activeWorkspace ? (
                <>
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <i data-lucide={activeWorkspace.name}></i>
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {activeWorkspace.name}
                    </span>
                    <span className="truncate text-xs">PLAN_PLACEHOLDER</span>
                  </div>
                </>
              ) : (
                <div className="flex flex-row gap-4 items-center">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500"></span>
                  </span>
                  <div>Select a workspace</div>
                </div>
              )}
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Workspaces
            </DropdownMenuLabel>
            {workspaces.map((workspace, index) => (
              <DropdownMenuItem
                key={workspace._id}
                onClick={() => handleWorkspaceSelect(workspace._id)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-sm border">
                  <i data-lucide={workspace.name} />
                </div>
                {workspace.name}
                <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />

            <DropdownMenuItem
              className="gap-2 p-2"
              onClick={() => setShowInviteDialog(true)}
              disabled={!activeWorkspace}
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <UserPlus className="size-4" />
              </div>
              <div className="font-medium text-muted-foreground">
                Invite a user
              </div>
            </DropdownMenuItem>

            <DropdownMenuItem
              className="gap-2 p-2"
              onClick={() => setShowCreateDialog(true)}
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <Plus className="size-4" />
              </div>
              <div className="font-medium text-muted-foreground">
                Create a workspace
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <CreateWorkspaceDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
      {activeWorkspace && (
        <InviteUserDialog
          workspaceId={activeWorkspace!._id}
          open={showInviteDialog}
          onOpenChange={setShowInviteDialog}
        />
      )}
    </SidebarMenu>
  );
}
