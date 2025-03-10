import { AppSidebar } from "./components/AppSidebar";
import { SidebarInset, SidebarTrigger, useSidebar } from "./components/ui/sidebar";

import { Authenticated, Unauthenticated } from "convex/react";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { DynamicBreadcrumb } from "./components/Breadcrumb";
import { Separator } from "./components/ui/separator";
import { cn } from "./lib/utils";
import { SignInForm } from "./SignInForm";

export function Layout() {
  const { pathname } = useLocation()
  const { isMobile, state, setOpenMobile } = useSidebar();

  useEffect(() => {
    if (pathname === '/') setOpenMobile(true)
  }, [pathname])

  return (
    <>
      <Authenticated>
        <AppSidebar />
        <SidebarInset>
          <header className="flex shrink-0 sticky top-0 px-4 z-10 h-16 items-center border-b backdrop-blur bg-background/80">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <DynamicBreadcrumb />
          </header>
          {/* this solution is from https://github.com/shadcn-ui/ui/issues/5545 */}
          <div
            className={cn("flex h-[calc(100svh-4rem)]", {
              "w-svw": isMobile,
              "w-[calc(100svw-var(--sidebar-width))]": !isMobile && state === "expanded",
              "w-[calc(100svw-var(--sidebar-width-icon))]": !isMobile && state === "collapsed",
            })}
          >
            <Outlet />
          </div>
        </SidebarInset>
      </Authenticated>
      <Unauthenticated>
        <SignInForm />
      </Unauthenticated>
    </>
  );
}
