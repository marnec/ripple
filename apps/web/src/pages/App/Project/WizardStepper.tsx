import { cn } from "@/lib/utils";

/**
 * Numbered step rail shared by the provider connect wizards. Purely
 * presentational — the wizard owns the step state and decides how many steps
 * there are (GitHub imports issues, so it has a filter/preview pair GitLab
 * has no equivalent for).
 */
export function WizardStepper<T extends string>({
  steps,
  current,
}: {
  steps: readonly { key: T; label: string }[];
  current: T;
}) {
  const currentIndex = steps.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-1.5 text-xs">
      {steps.map((s, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-medium transition-colors",
                active && "border-primary bg-primary text-primary-foreground",
                done && "border-primary/40 bg-primary/10 text-primary",
                !active &&
                  !done &&
                  "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <span
              className={cn(
                active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span className="mx-0.5 h-px w-3 bg-border" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
