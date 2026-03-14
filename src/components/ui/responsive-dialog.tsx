import * as React from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const ResponsiveDialogContext = React.createContext(false);

export function useResponsiveDialog() {
  return React.useContext(ResponsiveDialogContext);
}

type ResponsiveDialogProps = {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Direction the mobile drawer opens from. Defaults to "bottom". Use "top" for dialogs with inputs to avoid keyboard interference. */
  direction?: "bottom" | "top";
};

function ResponsiveDialog({
  children,
  open,
  onOpenChange,
  direction = "bottom",
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile();

  return (
    <ResponsiveDialogContext.Provider value={isMobile}>
      {isMobile ? (
        <Drawer open={open} onOpenChange={onOpenChange} direction={direction} autoFocus>{children}</Drawer>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>{children}</Dialog>
      )}
    </ResponsiveDialogContext.Provider>
  );
}

function ResponsiveDialogTrigger(
  props: React.ComponentProps<typeof DialogTrigger>
) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  if (isMobile) {
    // Base UI DialogTrigger uses `render` to compose onto a custom element;
    // vaul DrawerTrigger uses `asChild` + children for the same purpose.
    const { render, ...rest } = props;
    if (render) {
      return (
        <DrawerTrigger asChild {...(rest as React.ComponentProps<typeof DrawerTrigger>)}>
          {render as React.ReactElement}
        </DrawerTrigger>
      );
    }
    return <DrawerTrigger {...(rest as React.ComponentProps<typeof DrawerTrigger>)} />;
  }
  return <DialogTrigger {...props} />;
}

function ResponsiveDialogContent({
  children,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  if (isMobile) {
    return (
      <DrawerContent>
        <AutoFocusGuard>{children}</AutoFocusGuard>
      </DrawerContent>
    );
  }
  return <DialogContent {...props}>{children}</DialogContent>;
}

/**
 * When a drawer with an input opens from another drawer (e.g. rename dialog
 * opened from a dropdown-menu drawer), the closing drawer's Radix FocusScope
 * fires onUnmountAutoFocus after a setTimeout(0) + 500ms exit animation,
 * which restores focus to the trigger button — stealing it from the input.
 *
 * React's autoFocus sets focus during commit, but it gets stolen well after
 * mount. This guard watches for focus leaving an input/textarea inside the
 * container and re-asserts it, covering both immediate Radix FocusScope
 * effects and the delayed unmount focus restoration from other drawers.
 */
function AutoFocusGuard({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const container = ref.current;
    if (!container) return;
    // Find the autoFocus target — either already focused or first input.
    let target: HTMLElement | null = null;
    if (
      document.activeElement instanceof HTMLElement &&
      container.contains(document.activeElement) &&
      isInput(document.activeElement)
    ) {
      target = document.activeElement;
    }
    // Guard: if focus leaves the target within the protection window,
    // re-assert it. This covers the closing dropdown drawer's delayed
    // onUnmountAutoFocus (setTimeout(0) after 500ms exit animation).
    function onFocusOut(e: FocusEvent) {
      if (!target) {
        // Target hasn't been focused yet — try to find it on first focusin
        return;
      }
      const next = e.relatedTarget as HTMLElement | null;
      // Only intervene if focus is leaving to something outside our container
      if (!next || !container!.contains(next)) {
        requestAnimationFrame(() => {
          if (target && document.activeElement !== target) {
            target.focus();
          }
        });
      }
    }
    function onFocusIn(e: FocusEvent) {
      // Capture the first input to receive focus if we missed it at mount
      if (!target && e.target instanceof HTMLElement && isInput(e.target)) {
        target = e.target;
      }
    }
    container.addEventListener("focusout", onFocusOut);
    container.addEventListener("focusin", onFocusIn);
    // Also do an initial focus assertion after mount in case autoFocus
    // hasn't fired yet (the input might not exist until children render).
    const raf = requestAnimationFrame(() => {
      if (!target) {
        const input = container.querySelector<HTMLElement>("input, textarea");
        if (input?.hasAttribute("autofocus")) {
          target = input;
          input.focus();
        }
      }
    });
    // Stop guarding after the danger window passes (exit animation + buffer)
    const timeout = setTimeout(() => {
      container.removeEventListener("focusout", onFocusOut);
      container.removeEventListener("focusin", onFocusIn);
    }, 800);
    return () => {
      container.removeEventListener("focusout", onFocusOut);
      container.removeEventListener("focusin", onFocusIn);
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, []);
  return <div ref={ref}>{children}</div>;
}

function isInput(el: HTMLElement) {
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

function ResponsiveDialogHeader(
  props: React.ComponentProps<typeof DialogHeader>
) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  if (isMobile) {
    return <DrawerHeader {...props} />;
  }
  return <DialogHeader {...props} />;
}

function ResponsiveDialogTitle(
  props: React.ComponentProps<typeof DialogTitle>
) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  if (isMobile) {
    return <DrawerTitle {...(props as React.ComponentProps<typeof DrawerTitle>)} />;
  }
  return <DialogTitle {...props} />;
}

function ResponsiveDialogDescription(
  props: React.ComponentProps<typeof DialogDescription>
) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  if (isMobile) {
    return <DrawerDescription {...(props as React.ComponentProps<typeof DrawerDescription>)} />;
  }
  return <DialogDescription {...props} />;
}

function ResponsiveDialogFooter(
  props: React.ComponentProps<typeof DialogFooter>
) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  if (isMobile) {
    return <DrawerFooter {...(props as React.ComponentProps<typeof DrawerFooter>)} />;
  }
  return <DialogFooter {...props} />;
}

function ResponsiveDialogBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  return (
    <div
      data-slot="responsive-dialog-body"
      className={cn(isMobile ? "px-4" : undefined, className)}
      {...props}
    />
  );
}

function ResponsiveDialogClose(
  props: React.ComponentProps<typeof DialogClose>
) {
  const isMobile = React.useContext(ResponsiveDialogContext);
  if (isMobile) {
    return <DrawerClose {...(props as React.ComponentProps<typeof DrawerClose>)} />;
  }
  return <DialogClose {...props} />;
}

export {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
};
