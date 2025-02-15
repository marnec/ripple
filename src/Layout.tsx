import { ReactNode } from "react";
import { AppSidebar } from "./components/AppSidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./components/ui/sidebar";

import { Authenticated } from "convex/react";
import { DynamicBreadcrumb } from "./components/Breadcrumb";
import { Separator } from "./components/ui/separator";

export function Layout({ children }: { menu?: ReactNode; children: ReactNode }) {
  
  return (
    <SidebarProvider >
      <Authenticated>
        <AppSidebar />
      </Authenticated>
      <SidebarInset>
        <header className="flex sticky top-0 z-10 bg-background/80 h-16 shrink-0 items-center border-b backdrop-blur px-4">
          <Authenticated>
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </Authenticated>
          <DynamicBreadcrumb />
        </header>
        <div className="h-[calc(100dvh-64px)]">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
