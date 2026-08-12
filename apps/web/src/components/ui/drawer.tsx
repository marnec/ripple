"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"

import { cn } from "@/lib/utils"

/**
 * LOCAL PATCH: ported from vaul to Base UI's Drawer (dropping the last direct
 * `@radix-ui/react-dialog` carrier in the app).
 *
 * The public surface deliberately keeps vaul's naming — a `direction` prop
 * describing the *edge the drawer is anchored to*, and a single `DrawerContent`
 * composite — because every call site is written in those terms. Base UI names
 * its prop after the *dismiss gesture* (`swipeDirection`) and splits the panel
 * into Backdrop / Viewport / Popup / Content, so both are mapped here.
 */
type DrawerDirection = "bottom" | "top" | "left" | "right"

const SWIPE_DIRECTION = {
  bottom: "down",
  top: "up",
  left: "left",
  right: "right",
} as const satisfies Record<DrawerDirection, "down" | "up" | "left" | "right">

/**
 * The Viewport positions the popup and sits *above* it in the tree, so it
 * cannot read the popup's `data-swipe-direction`. Carry the edge in context.
 */
const DrawerDirectionContext = React.createContext<DrawerDirection>("bottom")

/** Where the Viewport parks the popup within the fixed full-screen layer. */
const VIEWPORT_ALIGN = {
  bottom: "items-end justify-center",
  top: "items-start justify-center",
  left: "items-stretch justify-start",
  right: "items-stretch justify-end",
} as const satisfies Record<DrawerDirection, string>

/** Size, rounding and border of the panel itself, per anchored edge. */
const POPUP_EDGE = {
  bottom: "w-full max-h-[80vh] rounded-t-xl border-t",
  top: "w-full max-h-[80vh] rounded-b-xl border-b",
  left: "h-full w-3/4 rounded-r-xl border-r sm:max-w-sm",
  right: "h-full w-3/4 rounded-l-xl border-l sm:max-w-sm",
} as const satisfies Record<DrawerDirection, string>

/**
 * Enter/exit transform, per anchored edge. Base UI does not animate the slide
 * itself: the resting transform tracks the live swipe offset, and the
 * starting/ending styles park the panel off-screen. `--drawer-swipe-strength`
 * scales the exit duration to the velocity of a fling.
 */
const POPUP_SLIDE = {
  bottom:
    "[transform:translateY(var(--drawer-swipe-movement-y))] data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)]",
  top: "[transform:translateY(var(--drawer-swipe-movement-y))] data-starting-style:[transform:translateY(-100%)] data-ending-style:[transform:translateY(-100%)]",
  left: "[transform:translateX(var(--drawer-swipe-movement-x))] data-starting-style:[transform:translateX(-100%)] data-ending-style:[transform:translateX(-100%)]",
  right:
    "[transform:translateX(var(--drawer-swipe-movement-x))] data-starting-style:[transform:translateX(100%)] data-ending-style:[transform:translateX(100%)]",
} as const satisfies Record<DrawerDirection, string>

function Drawer({
  direction = "bottom",
  ...props
}: Omit<DrawerPrimitive.Root.Props, "swipeDirection"> & {
  /** Edge the drawer is anchored to. Defaults to "bottom". */
  direction?: DrawerDirection
}) {
  return (
    <DrawerDirectionContext.Provider value={direction}>
      <DrawerPrimitive.Root
        swipeDirection={SWIPE_DIRECTION[direction]}
        {...props}
      />
    </DrawerDirectionContext.Provider>
  )
}

function DrawerTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({ ...props }: DrawerPrimitive.Portal.Props) {
  return <DrawerPrimitive.Portal {...props} />
}

function DrawerClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerBackdrop({
  className,
  ...props
}: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-backdrop"
      className={cn(
        // Opacity tracks the swipe so the scrim lifts as the panel is dragged away.
        "fixed inset-0 z-50 bg-black/10 opacity-[calc(1-var(--drawer-swipe-progress))] transition-opacity duration-450 ease-[cubic-bezier(0.32,0.72,0,1)] supports-backdrop-filter:backdrop-blur-xs data-swiping:duration-0 data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)]",
        className
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  ...props
}: DrawerPrimitive.Popup.Props) {
  const direction = React.useContext(DrawerDirectionContext)
  return (
    <DrawerPortal>
      <DrawerBackdrop />
      <DrawerPrimitive.Viewport
        data-slot="drawer-viewport"
        className={cn("fixed inset-0 z-50 flex", VIEWPORT_ALIGN[direction])}
      >
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            "group/drawer-content flex h-auto flex-col bg-background text-sm outline-none transition-transform duration-450 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-swiping:select-none",
            POPUP_EDGE[direction],
            POPUP_SLIDE[direction],
            className
          )}
          {...props}
        >
          <div className="mx-auto mt-4 hidden h-1 w-[100px] shrink-0 rounded-full bg-muted group-data-[swipe-direction=down]/drawer-content:block" />
          {/* Base UI reads `Drawer.Content` to let a mouse select text inside
              the panel without the drag being read as a swipe-to-dismiss. */}
          <DrawerPrimitive.Content className="flex min-h-0 flex-1 flex-col">
            {children}
          </DrawerPrimitive.Content>
          <div className="mx-auto mb-4 hidden h-1 w-[100px] shrink-0 rounded-full bg-muted group-data-[swipe-direction=up]/drawer-content:block" />
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPortal>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 group-data-[swipe-direction=down]/drawer-content:text-center group-data-[swipe-direction=up]/drawer-content:text-center md:gap-0.5 md:text-left",
        className
      )}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-base font-medium text-foreground", className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerPortal,
  DrawerBackdrop,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
