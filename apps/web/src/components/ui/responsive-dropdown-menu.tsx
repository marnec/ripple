import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const ResponsiveDropdownMenuContext = React.createContext<{
  isMobile: boolean;
  close: () => void;
}>({ isMobile: false, close: () => {} });

function ResponsiveDropdownMenu({
  children,
  direction,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  children: React.ReactNode;
  direction?: "top" | "bottom";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [openState, setOpenState] = React.useState(false);
  const open = openProp !== undefined ? openProp : openState;

  const handleOpenChange = React.useCallback(
    (value: boolean) => {
      if (openProp === undefined) setOpenState(value);
      onOpenChangeProp?.(value);
    },
    [openProp, onOpenChangeProp],
  );

  const close = React.useCallback(() => handleOpenChange(false), [handleOpenChange]);

  return (
    <ResponsiveDropdownMenuContext.Provider value={{ isMobile, close }}>
      {isMobile ? (
        <Drawer open={open} onOpenChange={handleOpenChange} direction={direction}>
          {children}
        </Drawer>
      ) : (
        <DropdownMenu open={open} onOpenChange={handleOpenChange}>{children}</DropdownMenu>
      )}
    </ResponsiveDropdownMenuContext.Provider>
  );
}

function ResponsiveDropdownMenuTrigger(
  props: React.ComponentProps<typeof DropdownMenuTrigger>,
) {
  const { isMobile } = React.useContext(ResponsiveDropdownMenuContext);
  if (isMobile) {
    const { render, children, ...rest } = props;
    if (render) {
      const triggerElement = React.cloneElement(
        render as React.ReactElement,
        {},
        children,
      );
      return (
        <DrawerTrigger
          asChild
          {...(rest as React.ComponentProps<typeof DrawerTrigger>)}
        >
          {triggerElement}
        </DrawerTrigger>
      );
    }
    return (
      <DrawerTrigger
        {...(rest as React.ComponentProps<typeof DrawerTrigger>)}
      >
        {children}
      </DrawerTrigger>
    );
  }
  return <DropdownMenuTrigger {...props} />;
}

function ResponsiveDropdownMenuContent({
  children,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  const { isMobile } = React.useContext(ResponsiveDropdownMenuContext);
  if (isMobile) {
    return (
      <DrawerContent>
        <DrawerTitle className="sr-only">Menu</DrawerTitle>
        <div className="flex flex-col p-3 pb-6">{children}</div>
      </DrawerContent>
    );
  }
  return (
    <DropdownMenuContent className={className} {...props}>
      {children}
    </DropdownMenuContent>
  );
}

function ResponsiveDropdownMenuItem({
  className,
  children,
  onSelect,
  disabled,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuItem>, "onClick"> & {
  onSelect?: () => void;
}) {
  const { isMobile, close } = React.useContext(ResponsiveDropdownMenuContext);
  if (isMobile) {
    return (
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm outline-none active:bg-accent",
          "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          disabled && "pointer-events-none opacity-50",
          className,
        )}
        onClick={() => {
          close();
          onSelect?.();
        }}
      >
        {children}
      </button>
    );
  }
  return (
    <DropdownMenuItem className={className} onClick={onSelect} disabled={disabled} {...props}>
      {children}
    </DropdownMenuItem>
  );
}

function ResponsiveDropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuSeparator>) {
  const { isMobile } = React.useContext(ResponsiveDropdownMenuContext);
  if (isMobile) {
    return <div className={cn("-mx-1 my-1 h-px bg-border", className)} />;
  }
  return <DropdownMenuSeparator className={className} {...props} />;
}

function ResponsiveDropdownMenuGroup({
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuGroup>) {
  const { isMobile } = React.useContext(ResponsiveDropdownMenuContext);
  if (isMobile) {
    return <div>{children}</div>;
  }
  return <DropdownMenuGroup {...props}>{children}</DropdownMenuGroup>;
}

function ResponsiveDropdownMenuLabel({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuLabel>) {
  const { isMobile } = React.useContext(ResponsiveDropdownMenuContext);
  if (isMobile) {
    return (
      <div className={cn("px-3 py-2 text-xs text-muted-foreground", className)}>
        {children}
      </div>
    );
  }
  return (
    <DropdownMenuLabel className={className} {...props}>
      {children}
    </DropdownMenuLabel>
  );
}

function ResponsiveDropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuShortcut>) {
  const { isMobile } = React.useContext(ResponsiveDropdownMenuContext);
  if (isMobile) {
    return null;
  }
  return <DropdownMenuShortcut className={className} {...props} />;
}

export {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuTrigger,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuSeparator,
  ResponsiveDropdownMenuGroup,
  ResponsiveDropdownMenuLabel,
  ResponsiveDropdownMenuShortcut,
};
