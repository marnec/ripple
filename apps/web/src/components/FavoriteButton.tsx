import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Star } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@ripple/ui/components/button";
import { cn } from "@/lib/utils";
import { useShortcut } from "@/contexts/ShortcutsContext";
import type { FavoritableResourceType as ResourceType } from "@ripple/shared/types/resources";

type FavoriteButtonProps = {
  resourceType: ResourceType;
  resourceId: string;
  workspaceId: Id<"workspaces">;
  variant?: "icon" | "ghost";
  className?: string;
  /**
   * Bind Mod+⇧S to this button. Only for the one star that stands for the
   * page's own resource (a surface or project header) — never for the stars
   * on a list, where the chord could not say which row it meant.
   */
  shortcut?: boolean;
};

export function FavoriteButton({
  resourceType,
  resourceId,
  workspaceId,
  variant = "ghost",
  className,
  shortcut = false,
}: FavoriteButtonProps) {
  const isFavorited = useQuery(api.favorites.isFavorited, { resourceId }) ?? false;
  const toggle = useMutation(api.favorites.toggle);

  const toggleFavorite = () => void toggle({ workspaceId, resourceType, resourceId });
  const shortcutRef = useShortcut("favorite", toggleFavorite, { enabled: shortcut });

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite();
  };

  return (
    <Button
      ref={shortcutRef}
      variant="ghost"
      size={variant === "icon" ? "icon" : "sm"}
      onClick={handleToggle}
      className={cn("h-7 w-7 p-0", className)}
      title={isFavorited ? "Remove from favorites" : "Add to favorites"}
    >
      <Star
        className={cn(
          "h-4 w-4",
          isFavorited
            ? "fill-yellow-400 text-yellow-400"
            : "text-muted-foreground",
        )}
      />
    </Button>
  );
}
