import { SidebarInset, SidebarTrigger, useSidebar } from "./ui/sidebar";

import { Phone } from "lucide-react";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useActiveCall } from "../contexts/ActiveCallContext";
import { useFollowMode } from "../contexts/FollowModeContext";
import { cn } from "../lib/utils";
import { DynamicBreadcrumb } from "./Breadcrumb";
import { FollowModeIndicator } from "./FollowModeIndicator";
import { Separator } from "./ui/separator";
import { ThemeToggle } from "./ThemeToggle";
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
  const { isMobile, state, setOpenMobile } = useSidebar();
  const { isFollowing, followColor } = useFollowMode();

  useEffect(() => {
    if (pathname === "/") setOpenMobile(true);
  }, [pathname, setOpenMobile]);

  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <header className="flex shrink-0 sticky top-0 px-4 pt-[var(--safe-area-top)] z-10 h-16 items-center justify-between border-b backdrop-blur bg-background/80">
          <div className="flex items-center">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />

            <DynamicBreadcrumb />
          </div>
          <div className="flex items-center gap-2">
            <FollowModeIndicator />
            <CallIndicator />
            <ThemeToggle />
          </div>
        </header>
        {/* this solution is from https://github.com/shadcn-ui/ui/issues/5545 */}
        <div
          className={cn("relative flex overflow-y-scroll scrollbar-sleek h-[calc(100svh-4rem-var(--safe-area-top))]", {
            "w-svw": isMobile,
            "w-[calc(100svw-var(--sidebar-width))]": !isMobile && state === "expanded",
            "w-[calc(100svw-var(--sidebar-width-icon))]": !isMobile && state === "collapsed",
          })}
        >
          {isFollowing && followColor && (
            <div
              className={`pointer-events-none absolute inset-0 z-30 ring-2 ring-inset ${followColor.ring}`}
            />
          )}
          <Outlet />
        </div>
      </SidebarInset>
    </>
  );
}
