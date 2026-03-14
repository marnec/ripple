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
        <Drawer open={open} onOpenChange={onOpenChange} direction={direction}>{children}</Drawer>
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
        {children}
      </DrawerContent>
    );
  }
  return <DialogContent {...props}>{children}</DialogContent>;
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
