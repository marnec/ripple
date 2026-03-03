import type { FavoriteFilter } from "@/hooks/use-debounced-search";
import { Star, StarOff } from "lucide-react";

const FILTER_CONFIG: Record<FavoriteFilter, {
  label: string;
  icon: typeof Star;
  filled: boolean;
  className: string;
}> = {
  all: {
    label: "All",
    icon: Star,
    filled: false,
    className: "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
  },
  favorites: {
    label: "Favorites",
    icon: Star,
    filled: true,
    className: "border-favorite/40 bg-favorite/10 text-favorite-foreground",
  },
  unfavorited: {
    label: "Unstarred",
    icon: StarOff,
    filled: false,
    className: "border-unfavorited/40 bg-unfavorited/10 text-unfavorited-foreground",
  },
};

type FavoriteFilterButtonProps = {
  value: FavoriteFilter;
  onToggle: () => void;
};

export function FavoriteFilterButton({ value, onToggle }: FavoriteFilterButtonProps) {
  const config = FILTER_CONFIG[value];
  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex h-10 shrink-0 items-center gap-1.5 rounded-md border px-2 text-sm transition-colors sm:px-3 ${config.className}`}
    >
      <Icon className={`h-4 w-4 ${config.filled ? "fill-current" : ""}`} />
      <span className="hidden sm:inline">{config.label}</span>
    </button>
  );
}
