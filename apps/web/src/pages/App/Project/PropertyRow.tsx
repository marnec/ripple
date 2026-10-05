import { Label } from "@/components/ui/label";

type PropertyRowProps = {
  label: string;
  alignTop?: boolean;
  children: React.ReactNode;
};

/**
 * Trigger styling for a property value: borderless until hovered, so a column
 * of properties reads as data rather than as a form. The chevron (the
 * trigger's last direct child) only shows on hover/focus — always on touch,
 * where there is no hover to reveal it.
 */
export const PROPERTY_TRIGGER_CLASS =
  "w-full border-transparent bg-transparent shadow-none hover:bg-muted/60 aria-expanded:bg-muted/60 dark:bg-transparent dark:hover:bg-muted/60 pointer-coarse:h-9 [&>svg:last-child]:opacity-0 hover:[&>svg:last-child]:opacity-100 focus-visible:[&>svg:last-child]:opacity-100 pointer-coarse:[&>svg:last-child]:opacity-100";

// Fixed label column rather than a viewport breakpoint: the same rows render
// in a 44rem sheet, a phone, and a 20rem page rail, and a `md:grid-cols-3`
// split sized for none of them.
export function PropertyRow({ label, alignTop, children }: PropertyRowProps) {
  return (
    <div className={`grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 ${alignTop ? "items-start" : "items-center"}`}>
      <Label className={`text-sm text-muted-foreground ${alignTop ? "pt-1.5" : ""}`}>{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
