/* eslint-disable react-refresh/only-export-components */
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

export interface SettingsSection {
  /** Stable id, persisted to the `?tab=` search param. */
  value: string;
  /** Nav-rail label. */
  label: string;
  icon: LucideIcon;
  /** Content-panel heading; defaults to `label`. */
  title?: string;
  /** One-line description under the panel heading. */
  description?: string;
  /** Tints the rail item + heading for destructive areas. */
  destructive?: boolean;
}

/**
 * Resolve the active settings section from the `?tab=` search param,
 * falling back to the first section when the param is missing or names a
 * section that isn't available (e.g. a non-creator deep-linking into a
 * gated section). The setter uses `replace` so flipping sections doesn't
 * pile up browser history.
 */
export function useSettingsSection(sections: SettingsSection[]): {
  active: SettingsSection;
  setActive: (value: string) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const active =
    (requested ? sections.find((s) => s.value === requested) : undefined) ??
    sections[0];

  const setActive = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", value);
        return next;
      },
      { replace: true },
    );
  };

  return { active, setActive };
}

/**
 * Two-pane settings shell: a vertical nav rail (left) + a scrollable
 * content panel that owns each section's heading and description. On
 * mobile the rail folds into a horizontally-scrolling row pinned above
 * the content. The content remounts on section change for a soft fade.
 */
export function SettingsLayout({
  eyebrow,
  sections,
  active,
  onChange,
  children,
}: {
  /** Small uppercase label above the rail (e.g. "Workspace", "Project"). */
  eyebrow?: ReactNode;
  sections: SettingsSection[];
  active: SettingsSection;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav className="shrink-0 border-b md:w-60 md:border-b-0 md:border-r md:overflow-y-auto">
        {eyebrow && (
          <div className="hidden px-4 pb-2 pt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground md:block">
            {eyebrow}
          </div>
        )}
        <div className="flex gap-1 overflow-x-auto p-2 md:flex-col md:px-3 md:pb-4 md:overflow-x-visible">
          {sections.map((section) => {
            const isActive = section.value === active.value;
            return (
              <button
                key={section.value}
                type="button"
                onClick={() => onChange(section.value)}
                aria-label={section.label}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? section.destructive
                      ? "bg-destructive/10 text-destructive"
                      : "bg-accent text-accent-foreground"
                    : section.destructive
                      ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <section.icon className="size-4 shrink-0" />
                <span className="hidden md:inline">{section.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="min-h-0 flex-1 overflow-auto">
        <div
          key={active.value}
          className="mx-auto max-w-2xl animate-fade-in px-4 py-6 md:px-8 md:py-8"
        >
          <header className="mb-6">
            <h2
              className={cn(
                "text-xl font-semibold tracking-tight",
                active.destructive && "text-destructive",
              )}
            >
              {active.title ?? active.label}
            </h2>
            {active.description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {active.description}
              </p>
            )}
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}
