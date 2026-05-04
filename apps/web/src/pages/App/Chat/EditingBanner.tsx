import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

type EditingBannerProps = {
  onCancel: () => void;
};

export function EditingBanner({ onCancel }: EditingBannerProps) {
  return (
    <div className="flex items-center gap-2 rounded-sm border-l-4 border-amber-500 bg-amber-500/10 px-3 py-1.5 text-sm">
      <Pencil className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="flex-1 font-medium text-amber-700 dark:text-amber-300">
        Editing message
      </span>
      <span className="hidden sm:inline text-xs text-muted-foreground">
        <Kbd>Esc</Kbd> to cancel
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={onCancel}
        aria-label="Cancel edit"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
