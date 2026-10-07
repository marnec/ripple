import { SidebarInset, SidebarTrigger, useSidebar } from "./ui/sidebar";

import type { QueryParams } from "@convex/types/routes";
import { Captions, EyeClosed, Phone } from "lucide-react";
import { Profiler, useEffect, useState } from "react";
import { onRenderCallback } from "../lib/profiler-logger";
import { Outlet, useLocation, useParams } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { useActiveCall } from "../contexts/ActiveCallContext";
import { useFollowMode } from "../contexts/FollowModeContext";
import {
  HeaderSlotContext,
  HeaderTitleSlotContext,
  useHeaderSlotRef,
  useHeaderTitleSlotRef,
} from "../contexts/HeaderSlotContext";
import { WorkspaceMembersProvider } from "../contexts/WorkspaceMembersContext";
import { WorkspaceSidebarProvider } from "../contexts/WorkspaceSidebarContext";
import { DynamicBreadcrumb } from "./Breadcrumb";
import { FollowModeIndicator } from "./FollowModeIndicator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@ripple/ui/components/tooltip";
import { AppSidebar } from "@/pages/App/AppSidebar";
import { useFocusMode } from "../contexts/FocusModeContext";
import { useShortcut } from "../contexts/ShortcutsContext";
import { cn } from "@/lib/utils";
import { Button } from "@ripple/ui/components/button";

function CallIndicator() {
  const { status, isTranscribing, returnToCall } = useActiveCall();
  if (status !== "joined") return null;

  return (
    <>
      <button
        onClick={returnToCall}
        className="flex items-center gap-1.5 rounded-full bg-green-500/15 px-2.5 py-1 text-xs font-medium text-green-600 dark:text-green-400"
        title="In call"
      >
        <Phone className="h-3 w-3" />
        <span className="hidden sm:inline">In call</span>
      </button>
      {isTranscribing && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="flex cursor-default items-center gap-1.5 rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400" />
              }
            >
              <Captions className="h-3 w-3" />
              <span className="hidden sm:inline">Transcribing</span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                This call is being transcribed. The transcript document is
                generated after the call ends and may take a little while to
                appear.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const { workspaceId } = useParams<QueryParams>();
  const { isMobile, setOpen, toggleSidebar } = useSidebar();
  const { isFollowing, followColor } = useFollowMode();
  const { isFocused, exitFocus, toggleFocus } = useFocusMode();
  const [commandOpen, setCommandOpen] = useState(false);
  const [headerSlotCallbackRef, headerSlotNode] = useHeaderSlotRef();
  const [headerTitleSlotCallbackRef, headerTitleSlotNode] = useHeaderTitleSlotRef();

  useEffect(() => {
    if (pathname === "/" && isMobile) setOpen(true);
  }, [pathname, isMobile, setOpen]);

  // The shell never scrolls the root — every pane owns its own scroller — but
  // iOS Safari still scrolls it behind `overflow: hidden` (focusing an input to
  // clear the keyboard, or an offset carried over from the root-scrolling auth
  // pages). The header is sticky, so it stays put while the whole page slides up
  // under it, and with the root unscrollable by touch the offset is permanent:
  // the top of every page is clipped until reload. Snap it back.
  useEffect(() => {
    const resetRootScroll = () => {
      if (window.scrollY !== 0 && !document.body.classList.contains("document-scroll")) {
        window.scrollTo(0, 0);
      }
    };
    resetRootScroll();
    window.addEventListener("scroll", resetRootScroll);
    window.visualViewport?.addEventListener("resize", resetRootScroll);
    return () => {
      window.removeEventListener("scroll", resetRootScroll);
      window.visualViewport?.removeEventListener("resize", resetRootScroll);
    };
  }, []);

  useShortcut("search", () => setCommandOpen((prev) => !prev), { enabled: Boolean(workspaceId) });
  // Focus mode. Not Escape: on a diagram Escape cancels the active tool and
  // clears the selection, and stealing it would make focus mode cost the
  // user a canvas shortcut they use constantly. The visible exit control is
  // the discoverable way out; this is the shortcut for people who want one.
  useShortcut("focusMode", toggleFocus);
  const sidebarToggleRef = useShortcut("toggleSidebar", toggleSidebar);

  const inner = (
    <>
      <Profiler id="AppSidebar" onRender={onRenderCallback}>
      <AppSidebar />
      </Profiler>
      <SidebarInset className="min-w-0">
        <header
          className={cn(
            "flex shrink-0 sticky top-0 px-4 pt-(--safe-area-top) z-10 h-16 items-center justify-between border-b backdrop-blur bg-background/80",
            // Hidden rather than unmounted: the header hosts the portal targets
            // every page's HeaderSlot renders into, and tearing those down on
            // entering focus mode would unmount their contents mid-flight.
            isFocused && "hidden",
          )}
        >
          {isMobile ? (
            <>
              <SidebarTrigger className="-ml-1 shrink-0" />
              <div className="flex-1 min-w-0 flex items-center justify-start px-2">
                <div
                  ref={headerTitleSlotCallbackRef}
                  // flex-1: a renamable title fills the gap up to the
                  // controls, so all of it is one tap target.
                  className="peer flex flex-1 items-center gap-2 min-w-0 empty:hidden"
                />
                <div className="hidden peer-empty:flex items-center gap-2 min-w-0">
                  <DynamicBreadcrumb />
                </div>
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
                <SidebarTrigger ref={sidebarToggleRef} className="-ml-1" />
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
          className={cn(
            "w-full overflow-auto",
            isFocused
              // Promoted over the chrome instead of collapsing it: the sidebar
              // keeps its own state and its queries stay warm, so leaving focus
              // mode is instant and puts everything back exactly as it was.
              ? "fixed inset-0 z-40 bg-background pt-(--safe-area-top)"
              : "relative h-[calc(100svh-4rem-var(--safe-area-top))]",
          )}
        >
          {isFollowing && followColor && (
            <div
              className={`pointer-events-none absolute inset-0 z-30 ring-2 ring-inset ${followColor.ring}`}
            />
          )}
          {isFocused && (
            // Bottom centre, because every corner is spoken for by the surfaces
            // themselves — Excalidraw's toolbars occupy all four. Dimmed until
            // hovered so it reads as an escape hatch, not a control.
            <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={exitFocus}
                className="pointer-events-auto gap-1.5 rounded-full border bg-background/80 px-3 opacity-40 shadow-sm backdrop-blur transition-opacity hover:opacity-100 focus-visible:opacity-100"
              >
                <EyeClosed className="size-4" />
                Exit focus
              </Button>
            </div>
          )}
          <HeaderSlotContext value={headerSlotNode}>
            <HeaderTitleSlotContext value={headerTitleSlotNode}>
              <Profiler id="PageContent" onRender={onRenderCallback}>
              <Outlet />
              </Profiler>
            </HeaderTitleSlotContext>
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
