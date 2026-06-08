import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { navigate, useRouteSegments } from "../hooks/useHashRoute";
import { OverviewPage } from "../pages/Overview";
import { UserDetailPage, UsersPage } from "../pages/Users";
import { WorkspaceDetailPage, WorkspacesPage } from "../pages/Workspaces";
import { cn } from "../lib/cn";
import {
  GaugeIcon,
  LogOutIcon,
  MailIcon,
  PlugIcon,
  UsersIcon,
  WorkspacesIcon,
} from "./icons";
import { Avatar } from "./ui";

type NavItem = { label: string; path: string; icon: (p: { className?: string }) => ReactNode };

const NAV: NavItem[] = [
  { label: "Overview", path: "/", icon: GaugeIcon },
  { label: "Users", path: "/users", icon: UsersIcon },
  { label: "Workspaces", path: "/workspaces", icon: WorkspacesIcon },
];

// Surfaced but inert — signals the roadmap without pretending to work.
const SOON: NavItem[] = [
  { label: "Invites", path: "/invites", icon: MailIcon },
  { label: "Integrations", path: "/integrations", icon: PlugIcon },
];

export function AppShell() {
  const segments = useRouteSegments();
  const top = segments[0] ?? "";

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar active={top} />
      <main className="console-grid flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10">
          <Routed segments={segments} />
        </div>
      </main>
    </div>
  );
}

function Routed({ segments }: { segments: string[] }) {
  const [top, id] = segments;
  switch (top) {
    case undefined:
      return <OverviewPage />;
    case "users":
      return id ? <UserDetailPage userId={id as Id<"users">} /> : <UsersPage />;
    case "workspaces":
      return id ? (
        <WorkspaceDetailPage workspaceId={id as Id<"workspaces">} />
      ) : (
        <WorkspacesPage />
      );
    default:
      return <OverviewPage />;
  }
}

function Sidebar({ active }: { active: string }) {
  const { signOut } = useAuthActions();
  const viewer = useQuery(api.users.viewer);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-stone-800 bg-stone-900/30">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid size-8 place-items-center rounded-md bg-accent font-mono text-sm font-bold text-stone-950">
          R
        </div>
        <div className="leading-tight">
          <div className="font-mono text-sm font-semibold tracking-wide text-stone-100">
            RIPPLE
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">
            Admin
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map((item) => (
          <NavLink key={item.path} item={item} active={isActive(active, item.path)} />
        ))}

        <div className="px-2 pb-1 pt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600">
          Soon
        </div>
        {SOON.map((item) => (
          <div
            key={item.path}
            className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-stone-600"
            title="Coming soon"
          >
            <item.icon className="size-[18px]" />
            {item.label}
          </div>
        ))}
      </nav>

      <div className="border-t border-stone-800 p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <Avatar name={viewer?.name} email={viewer?.email} image={viewer?.image} className="size-7" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-stone-200">
              {viewer?.name ?? "—"}
            </div>
            <div className="truncate font-mono text-[10px] text-stone-500">
              {viewer?.email ?? ""}
            </div>
          </div>
          <button
            onClick={() => void signOut()}
            title="Sign out"
            className="grid size-7 place-items-center rounded-md text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200"
          >
            <LogOutIcon className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function isActive(active: string, path: string) {
  if (path === "/") return active === "";
  return "/" + active === path;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <button
      onClick={() => navigate(item.path)}
      className={cn(
        "relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-stone-800/60 font-medium text-stone-100"
          : "text-stone-400 hover:bg-stone-800/40 hover:text-stone-200",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
      )}
      <item.icon className={cn("size-[18px]", active && "text-accent")} />
      {item.label}
    </button>
  );
}
