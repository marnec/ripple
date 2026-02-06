// your-tooltip.jsx
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import React from "react";

export function Tooltip({
  children,
  content,
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
} & TooltipPrimitive.TooltipContentProps) {
  return (
    <TooltipPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Content side="top" align="center" {...props}>
        {content}
        <TooltipPrimitive.Arrow width={11} height={5} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Root>
  );
}
