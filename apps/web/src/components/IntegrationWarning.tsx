import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Single source of truth for the amber "warning / frozen / heads-up" callout
 * used across integration surfaces (project connect card, workspace settings,
 * resync dialog). Centralizes the amber light/dark palette so the tokens stop
 * being copy-pasted (and drifting) per call site.
 *
 * - `subtle`   — borderless inline note (xs), e.g. an in-row freeze banner.
 * - `bordered` — bordered callout (sm), the default; pass `icon` for a leading
 *                glyph with the matching amber tint.
 */
const VARIANTS = {
  subtle: "rounded-sm px-3 py-2 text-xs",
  bordered: "rounded-md border border-amber-300 p-3 text-sm dark:border-amber-800/60",
} as const;

export function IntegrationWarning({
  variant = "bordered",
  icon: Icon,
  className,
  children,
}: {
  variant?: keyof typeof VARIANTS;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
        VARIANTS[variant],
        Icon && "flex gap-3",
        className,
      )}
    >
      {Icon && (
        <Icon
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500"
          aria-hidden
        />
      )}
      <div className={Icon ? "space-y-2" : undefined}>{children}</div>
    </div>
  );
}
