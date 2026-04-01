import { SidebarInset, SidebarTrigger, useSidebar } from "./ui/sidebar";

import type { QueryParams } from "@shared/types/routes";
import { Phone } from "lucide-react";
import { Profiler, useEffect, useState } from "react";
import { onRenderCallback } from "../lib/profiler-logger";
import { Outlet, useLocation, useParams } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { useActiveCall } from "../contexts/ActiveCallContext";
import { useFollowMode } from "../contexts/FollowModeContext";
import { HeaderSlotContext, useHeaderSlotRef } from "../contexts/HeaderSlotContext";
import { WorkspaceMembersProvider } from "../contexts/WorkspaceMembersContext";
import { WorkspaceSidebarProvider } from "../contexts/WorkspaceSidebarContext";
import { DynamicBreadcrumb } from "./Breadcrumb";
import { FollowModeIndicator } from "./FollowModeIndicator";
import { AppSidebar } from "@/pages/App/AppSidebar";

function CallIndicator() {
  const { status, returnToCall } = useActiveCall();
  if (status !== "joined") return null;

  return (
    <button
      onClick={returnToCall}
      className="flex items-center gap-1.5 rounded-full bg-green-500/15 px-2.5 py-1 text-xs font-medium text-green-600 dark:text-green-400"
      title="In call"
    >
      <Phone className="h-3 w-3" />
      <span className="hidden sm:inline">In call</span>
    </button>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const { workspaceId } = useParams<QueryParams>();
  const { isMobile, setOpen } = useSidebar();
  const { isFollowing, followColor } = useFollowMode();
  const [commandOpen, setCommandOpen] = useState(false);
  const [headerSlotCallbackRef, headerSlotNode] = useHeaderSlotRef();

  useEffect(() => {
    if (pathname === "/" && isMobile) setOpen(true);
  }, [pathname, isMobile, setOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const inner = (
    <>
      <Profiler id="AppSidebar" onRender={onRenderCallback}>
      <AppSidebar />
      </Profiler>
      <SidebarInset className="min-w-0">
        <header className="flex shrink-0 sticky top-0 px-4 pt-(--safe-area-top) z-10 h-16 items-center justify-between border-b backdrop-blur bg-background/80">
          {isMobile ? (
            <>
              <SidebarTrigger className="-ml-1 shrink-0" />
              <div className="flex-1 min-w-0 flex justify-center px-2">
                <DynamicBreadcrumb />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div ref={headerSlotCallbackRef} className="flex items-center gap-2" />
                <FollowModeIndicator />
                <CallIndicator />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <SidebarTrigger className="-ml-1" />
                <DynamicBreadcrumb />
              </div>
              <div className="flex items-center gap-2">
                <div ref={headerSlotCallbackRef} className="flex items-center gap-2" />
                <FollowModeIndicator />
                <CallIndicator />
              </div>
            </>
          )}
        </header>
        <div
          className="relative h-[calc(100svh-4rem-var(--safe-area-top))] w-full overflow-auto"
        >
          {isFollowing && followColor && (
            <div
              className={`pointer-events-none absolute inset-0 z-30 ring-2 ring-inset ${followColor.ring}`}
            />
          )}
          <HeaderSlotContext value={headerSlotNode}>
            <Profiler id="PageContent" onRender={onRenderCallback}>
            <Outlet />
            </Profiler>
          </HeaderSlotContext>
        </div>
      </SidebarInset>
      {workspaceId && (
        <CommandPalette
          workspaceId={workspaceId}
          open={commandOpen}
          onOpenChange={setCommandOpen}
        />
      )}
    </>
  );

  if (workspaceId) {
    return (
      <WorkspaceMembersProvider workspaceId={workspaceId}>
        <WorkspaceSidebarProvider workspaceId={workspaceId}>
          {inner}
        </WorkspaceSidebarProvider>
      </WorkspaceMembersProvider>
    );
  }

  return inner;
}
