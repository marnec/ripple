"use client"

/**
 * CalendarSidebar — a scoped clone of shadcn Sidebar for use inside the
 * calendar page. Key differences from the root Sidebar:
 *
 * 1. Provider wrapper uses `h-full` instead of `min-h-svh` — safe to nest.
 * 2. Provider wrapper is `position: relative` so the sidebar container can
 *    use `position: absolute` instead of `position: fixed`, keeping it
 *    fully contained within the calendar area.
 * 3. Sidebar container: `absolute inset-y-0` instead of `fixed inset-y-0 h-svh`.
 * 4. No Ctrl+B keyboard shortcut (would conflict with the app sidebar).
 * 5. No mobile overlay / openMobile state — mobile is handled separately.
 * 6. Different cookie name so state doesn't bleed into the app sidebar.
 * 7. Defaults: side="right", defaultOpen=false.
 * 8. SidebarInset is a <div> (not <main>) to avoid nested landmark issues.
 */

import * as React from "react"
import { cn } from "@/lib/utils"

const COOKIE_NAME = "calendar_sidebar_state"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "16rem"

// ─── Context ────────────────────────────────────────────────────────────────

type CalendarSidebarContextProps = {
  open: boolean
  setOpen: (open: boolean) => void
  toggleSidebar: () => void
}

const CalendarSidebarContext =
  React.createContext<CalendarSidebarContextProps | null>(null)

export function useCalendarSidebar() {
  const ctx = React.useContext(CalendarSidebarContext)
  if (!ctx) {
    throw new Error("useCalendarSidebar must be used within CalendarSidebarProvider")
  }
  return ctx
}

// ─── Provider ───────────────────────────────────────────────────────────────

export function CalendarSidebarProvider({
  defaultOpen = false,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open

  const setOpen = React.useCallback(
    (value: boolean | ((v: boolean) => boolean)) => {
      const next = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(next)
      } else {
        _setOpen(next)
      }
      document.cookie = `${COOKIE_NAME}=${next}; path=/; max-age=${COOKIE_MAX_AGE}`
    },
    [setOpenProp, open],
  )

  const toggleSidebar = React.useCallback(() => setOpen((v) => !v), [setOpen])

  const ctx = React.useMemo(
    () => ({ open, setOpen, toggleSidebar }),
    [open, setOpen, toggleSidebar],
  )

  return (
    <CalendarSidebarContext.Provider value={ctx}>
      <div
        data-slot="calendar-sidebar-wrapper"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          // h-full + relative so the absolute sidebar is scoped here
          // overflow-hidden clips the panel when it slides off-screen (prevents horizontal scrollbar)
          "relative flex h-full w-full overflow-hidden",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </CalendarSidebarContext.Provider>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function CalendarSidebar({
  side = "right",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
}) {
  const { open } = useCalendarSidebar()
  const state = open ? "expanded" : "collapsed"

  return (
    <div
      className="group peer text-sidebar-foreground"
      data-state={state}
      data-collapsible={state === "collapsed" ? "offcanvas" : ""}
      data-side={side}
      data-slot="calendar-sidebar"
    >
      {/* Gap div — this is what pushes the adjacent content */}
      <div
        data-slot="calendar-sidebar-gap"
        className={cn(
          "relative shrink-0 bg-transparent transition-[width] duration-200 ease-linear",
          "w-(--sidebar-width) group-data-[collapsible=offcanvas]:w-0",
        )}
      />
      {/* Actual sidebar panel — absolute so it floats over the gap */}
      <div
        data-slot="calendar-sidebar-container"
        data-side={side}
        className={cn(
          "absolute inset-y-0 z-10 flex h-full w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear",
          side === "left"
            ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)] border-r"
            : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)] border-l",
          className,
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="calendar-sidebar-inner"
          className="flex size-full flex-col bg-background"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

// ─── Inset (main content area) ───────────────────────────────────────────────

/** Wraps the main content beside the sidebar. Use a div, not main. */
export function CalendarSidebarInset({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="calendar-sidebar-inset"
      className={cn("relative flex min-h-0 flex-1 flex-col", className)}
      {...props}
    />
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

export function CalendarSidebarHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="calendar-sidebar-header"
      className={cn("flex shrink-0 flex-col gap-2 p-3 border-b", className)}
      {...props}
    />
  )
}

export function CalendarSidebarContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="calendar-sidebar-content"
      className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}
      {...props}
    />
  )
}
