import { useMutation, useQuery } from "convex/react";
import { Star } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useOptimisticIsFavorited } from "@/contexts/FavoritesContext";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

type ResourceType = "document" | "diagram" | "spreadsheet" | "project";

type FavoriteButtonProps = {
  resourceType: ResourceType;
  resourceId: string;
  workspaceId: Id<"workspaces">;
  variant?: "icon" | "ghost";
  className?: string;
};

export function FavoriteButton({
  resourceType,
  resourceId,
  workspaceId,
  variant = "ghost",
  className,
}: FavoriteButtonProps) {
  // Optimistic value from sidebar data — available immediately
  const optimistic = useOptimisticIsFavorited(resourceType, resourceId);
  // Confirmed value from per-resource query — arrives later
  const confirmed = useQuery(api.favorites.isFavorited, { resourceId });
  const toggle = useMutation(api.favorites.toggle);

  // Use confirmed value when available, otherwise fall back to optimistic
  const isFavorited = confirmed ?? optimistic ?? false;

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void toggle({ workspaceId, resourceType, resourceId });
  };

  return (
    <Button
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
