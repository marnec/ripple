import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MessageQuotePreviewProps = {
  message: {
    author: string;
    plainText: string;
    deleted: boolean;
  } | null;
  onCancel?: () => void;
  compact?: boolean;
};

export function MessageQuotePreview({ message, onCancel, compact = false }: MessageQuotePreviewProps) {
  if (!message) {
    return (
      <div className={cn(
        "flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-md border-l-2 border-muted-foreground/40 text-sm text-muted-foreground italic",
        compact && "py-1 text-xs"
      )}>
        [Original message not found]
      </div>
    );
  }

  if (message.deleted) {
    return (
      <div className={cn(
        "flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-md border-l-2 border-muted-foreground/40 text-sm text-muted-foreground italic",
        compact && "py-1 text-xs"
      )}>
        [Message deleted]
      </div>
    );
  }

  const truncatedText = message.plainText.length > 100
    ? message.plainText.slice(0, 100) + "..."
    : message.plainText;

  return (
    <div className={cn(
      "flex items-start gap-2 px-3 py-1.5 bg-muted/50 rounded-md border-l-2 border-primary",
      compact && "py-1"
    )}>
      <div className="flex-1 min-w-0">
        <div className={cn("font-semibold text-muted-foreground", compact ? "text-xs" : "text-xs")}>
          {message.author}
        </div>
        <div className={cn("truncate", compact ? "text-xs" : "text-sm")}>
          {truncatedText}
        </div>
      </div>
      {onCancel && (
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onCancel}>
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
