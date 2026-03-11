import { SidebarInset, SidebarTrigger, useSidebar } from "./ui/sidebar";

import { QueryParams } from "@shared/types/routes";
import { Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useLocation, useParams } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { PullToRefresh } from "./PullToRefresh";
import { useActiveCall } from "../contexts/ActiveCallContext";
import { useFollowMode } from "../contexts/FollowModeContext";
import { cn } from "../lib/utils";
import { DynamicBreadcrumb } from "./Breadcrumb";
import { FollowModeIndicator } from "./FollowModeIndicator";
import { Separator } from "./ui/separator";
import { AppSidebar } from "@/pages/App/AppSidebar";

function CallIndicator() {
  const { status, isFloating, returnToCall } = useActiveCall();
  if (status !== "joined") return null;
  // Only show when on the call route (not floating — floating has its own window)
  if (isFloating) return null;

  return (
    <button
      onClick={returnToCall}
      className="flex items-center gap-1.5 rounded-full bg-green-500/15 px-2.5 py-1 text-xs font-medium text-green-600 dark:text-green-400"
      title="In call"
    >
      <Phone className="h-3 w-3" />
      In call
    </button>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const { workspaceId } = useParams<QueryParams>();
  const { isMobile, state, setOpen } = useSidebar();
  const { isFollowing, followColor } = useFollowMode();
  const [commandOpen, setCommandOpen] = useState(false);

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

  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <header className="flex shrink-0 sticky top-0 px-4 pt-(--safe-area-top) z-10 h-16 items-center justify-between border-b backdrop-blur bg-background/80">
          {isMobile ? (
            <>
              <SidebarTrigger className="-ml-1 shrink-0" />
              <div className="flex-1 min-w-0 flex justify-center px-2">
                <DynamicBreadcrumb />
              </div>
              <div className="flex shrink-0 items-center gap-2">
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
                <FollowModeIndicator />
                <CallIndicator />
              </div>
            </>
          )}
        </header>
        <div
          className={cn("relative flex h-[calc(100svh-4rem-var(--safe-area-top))]", {
            "w-svw": isMobile || state === "collapsed",
            "w-[calc(100svw-var(--sidebar-width))]": !isMobile && state === "expanded",
          })}
        >
          {isFollowing && followColor && (
            <div
              className={`pointer-events-none absolute inset-0 z-30 ring-2 ring-inset ${followColor.ring}`}
            />
          )}
          <PullToRefresh>
            <Outlet />
          </PullToRefresh>
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
}
