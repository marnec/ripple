import { GitBranch } from "lucide-react";

const PROVIDER_LABEL: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
};

/**
 * Disclaimer shown next to the description editor while a task's description is
 * being seeded from its linked provider issue. Rendered only while the seed is
 * genuinely in flight (the parent gates on `awaitingSeed`, which tracks the
 * server's reactive `seedStatus`).
 *
 * Provider label is resolved from the task's integration so the copy matches
 * the actual source (GitHub vs GitLab). Falls back to "GitHub" for any
 * unknown provider string — the copy stays readable, just no provider switch.
 *
 * There's no fixed deadline — readiness is driven reactively by the seed status,
 * not a timer — so this shows an indeterminate spinner rather than a countdown.
 */
export function SeedingDescriptionNotice({ provider }: { provider: string }) {
  const label = PROVIDER_LABEL[provider] ?? "GitHub";
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground animate-fade-in">
      <GitBranch className="h-3.5 w-3.5 shrink-0" />
      <span className="mr-3">Seeding description from {label} issue…</span>
    </div>
  );
}
