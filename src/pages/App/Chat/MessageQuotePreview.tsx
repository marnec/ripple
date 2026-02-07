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
        "flex items-center gap-2 rounded-md border-l-2 border-muted-foreground/40 text-muted-foreground italic",
        compact
          ? "pl-2 py-0.5 mb-1.5 text-xs bg-background/30"
          : "px-3 py-1.5 bg-muted/50 text-sm"
      )}>
        [Original message not found]
      </div>
    );
  }

  if (message.deleted) {
    return (
      <div className={cn(
        "flex items-center gap-2 rounded-md border-l-2 border-muted-foreground/40 text-muted-foreground italic",
        compact
          ? "pl-2 py-0.5 mb-1.5 text-xs bg-background/30"
          : "px-3 py-1.5 bg-muted/50 text-sm"
      )}>
        [Message deleted]
      </div>
    );
  }

  const truncatedText = message.plainText.length > 100
    ? message.plainText.slice(0, 100) + "..."
    : message.plainText;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 mb-1.5 rounded-sm border-l-2 border-primary bg-background/30">
        <div className="min-w-0 flex items-baseline gap-1.5">
          <span className="shrink-0 text-[11px] font-semibold text-primary">
            {message.author}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {truncatedText}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 bg-muted/50 rounded-md border-l-2 border-primary">
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-xs text-muted-foreground">
          {message.author}
        </div>
        <div className="truncate text-sm">
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
