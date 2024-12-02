import { ReactNode } from "react";
import { AppSidebar } from "./components/AppSidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "./components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
} from "./components/ui/breadcrumb";
import { APP_NAME } from "@shared/constants";
import { Authenticated } from "convex/react";
import { Separator } from "./components/ui/separator";

export function Layout({
  children,
}: {
  menu?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      <Authenticated>
        <AppSidebar />
      </Authenticated>
      <SidebarInset>
        <header className="flex sticky top-0 z-10 bg-background/80 min-h-16 shrink-0 items-center border-b backdrop-blur px-4">
          <Authenticated>
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </Authenticated>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">{APP_NAME}</BreadcrumbLink>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <main className="flex grow flex-col overflow-hidden">{children}</main>

        <footer className="border-t hidden sm:block">
          <div className="container py-4 text-sm leading-loose">
            Built with ❤️ by Marco Necci. Powered by Convex,{" "}
            <FooterLink href="https://vitejs.dev">Vite</FooterLink>,{" "}
            <FooterLink href="https://react.dev/">React</FooterLink> and{" "}
            <FooterLink href="https://ui.shadcn.com/">shadcn/ui</FooterLink>.
          </div>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="underline underline-offset-4 hover:no-underline"
      target="_blank"
    >
      {children}
    </a>
  );
}
