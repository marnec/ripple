import { UserAvatar } from "@/components/console";
import { Button } from "@ripple/ui/components/button";
import { Separator } from "@ripple/ui/components/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@ripple/ui/components/tooltip";
import { navigate, useRouteSegments } from "@/hooks/useHashRoute";
import { cn } from "@/lib/utils";
import { InvitesPage } from "@/pages/Invites";
import { JobsPage } from "@/pages/Jobs";
import { UserDetailPage, UsersPage } from "@/pages/Users";
import { WorkspaceActivityPage } from "@/pages/WorkspaceActivity";
import { WorkspaceDetailPage, WorkspacesPage } from "@/pages/Workspaces";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import {
  Building2Icon,
  HeartPulseIcon,
  LogOutIcon,
  MailIcon,
  PlugIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";

type NavItem = { label: string; path: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { label: "Users", path: "/users", icon: UsersIcon },
  { label: "Workspaces", path: "/workspaces", icon: Building2Icon },
  { label: "Invites", path: "/invites", icon: MailIcon },
  { label: "Jobs", path: "/jobs", icon: HeartPulseIcon },
];

/**
 * There is no dashboard: platform-wide totals need un-namespaced aggregates
 * (the ones in `dbTriggers.ts` are keyed by `workspaceId`), so until those
 * exist the console lands on its first real page rather than on a page whose
 * only honest content was a failed-jobs tile.
 */
const HOME = NAV[0].path;

// Surfaced but inert — signals the roadmap without pretending to work.
const SOON: NavItem[] = [{ label: "Integrations", path: "/integrations", icon: PlugIcon }];

export function AppShell() {
  const segments = useRouteSegments();
  const top = segments[0] ?? "";

  // A bare "#/" renders HOME already; rewriting the hash canonicalises the URL
  // so the sidebar highlights the page the operator is actually looking at.
  useEffect(() => {
    if (segments.length === 0) navigate(HOME);
  }, [segments.length]);

  return (
    <TooltipProvider>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar active={top} />
        <main className="console-grid flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10">
            <Routed segments={segments} />
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

function Routed({ segments }: { segments: string[] }) {
  const [top, id, sub] = segments;
  switch (top) {
    // `undefined` is the bare "#/" that AppShell is about to rewrite to HOME;
    // rendering the same page for both means no blank frame and no remount.
    case undefined:
    case "users":
      return id ? <UserDetailPage userId={id as Id<"users">} /> : <UsersPage />;
    case "workspaces":
      if (!id) return <WorkspacesPage />;
      return sub === "activity" ? (
        <WorkspaceActivityPage workspaceId={id as Id<"workspaces">} />
      ) : (
        <WorkspaceDetailPage workspaceId={id as Id<"workspaces">} />
      );
    case "invites":
      return <InvitesPage />;
    case "jobs":
      return <JobsPage />;
    default:
      return <UsersPage />;
  }
}

function Sidebar({ active }: { active: string }) {
  const { signOut } = useAuthActions();
  const viewer = useQuery(api.users.viewer);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid size-8 place-items-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">
          R
        </div>
        <div className="leading-tight">
          <div className="font-mono text-sm font-semibold tracking-wide text-foreground">
            RIPPLE
          </div>
          <div className="font-mono text-[10px] tracking-[0.22em] text-primary uppercase">
            Admin
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map((item) => (
          <NavLink key={item.path} item={item} active={isActive(active, item.path)} />
        ))}

        <div className="px-2 pt-5 pb-1 font-mono text-[10px] tracking-[0.18em] text-muted-foreground/70 uppercase">
          Soon
        </div>
        {SOON.map((item) => (
          <Tooltip key={item.path}>
            <TooltipTrigger
              render={
                <div className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/70">
                  <item.icon className="size-4.5" />
                  {item.label}
                </div>
              }
            />
            <TooltipContent side="right">Coming soon</TooltipContent>
          </Tooltip>
        ))}
      </nav>

      <Separator />

      <div className="p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <UserAvatar
            name={viewer?.name}
            email={viewer?.email}
            image={viewer?.image}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{viewer?.name ?? "—"}</div>
            <div className="truncate font-mono text-[10px] text-muted-foreground">
              {viewer?.email ?? ""}
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" onClick={() => void signOut()}>
                  <LogOutIcon />
                </Button>
              }
            />
            <TooltipContent>Sign out</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}

function isActive(active: string, path: string) {
  if (active === "") return path === HOME;
  return "/" + active === path;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Button
      variant="ghost"
      onClick={() => navigate(item.path)}
      className={cn(
        "relative h-9 w-full justify-start gap-3 px-3 font-normal",
        active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground",
      )}
    >
      {active && (
        <span className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary" />
      )}
      <item.icon className={cn("size-4.5", active && "text-primary")} />
      {item.label}
    </Button>
  );
}
