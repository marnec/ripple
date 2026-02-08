import { SidebarInset, SidebarTrigger, useSidebar } from "./ui/sidebar";

import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { cn } from "../lib/utils";
import { DynamicBreadcrumb } from "./Breadcrumb";
import { Separator } from "./ui/separator";
import { ThemeToggle } from "./ThemeToggle";
import { AppSidebar } from "@/pages/App/AppSidebar";

export function Layout() {
  const { pathname } = useLocation();
  const { isMobile, state, setOpenMobile } = useSidebar();

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
          <ThemeToggle />
        </header>
        {/* this solution is from https://github.com/shadcn-ui/ui/issues/5545 */}
        <div
          className={cn("flex h-[calc(100svh-4rem-var(--safe-area-top))]", {
            "w-svw": isMobile,
            "w-[calc(100svw-var(--sidebar-width))]": !isMobile && state === "expanded",
            "w-[calc(100svw-var(--sidebar-width-icon))]": !isMobile && state === "collapsed",
          })}
        >
          <Outlet />
        </div>
      </SidebarInset>
    </>
  );
}
