import type { ChannelVisibilityFilter } from "@/hooks/use-debounced-search";
import { Globe, Lock, LayoutList } from "lucide-react";

const FILTER_CONFIG: Record<ChannelVisibilityFilter, {
  label: string;
  icon: typeof Globe;
  className: string;
}> = {
  all: {
    label: "All",
    icon: LayoutList,
    className: "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
  },
  public: {
    label: "Public",
    icon: Globe,
    className: "border-border bg-accent text-accent-foreground",
  },
  private: {
    label: "Private",
    icon: Lock,
    className: "border-border bg-accent text-accent-foreground",
  },
};

type ChannelVisibilityFilterButtonProps = {
  value: ChannelVisibilityFilter;
  onToggle: () => void;
};

export function ChannelVisibilityFilterButton({ value, onToggle }: ChannelVisibilityFilterButtonProps) {
  const config = FILTER_CONFIG[value];
  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-sm transition-colors sm:px-3 ${config.className}`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{config.label}</span>
    </button>
  );
}
