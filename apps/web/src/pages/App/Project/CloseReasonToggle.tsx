import { cn } from "@/lib/utils";
import type { CloseReason } from "./useStatusEffectWriters";

export function CloseReasonToggle({
  value,
  onChange,
  className,
}: {
  value: CloseReason;
  onChange: (value: CloseReason) => void;
  className?: string;
}) {
  return (
    <span className={cn("mx-auto flex w-fit overflow-hidden rounded-md border", className)}>
      {(
        [
          ["completed", "Completed"],
          ["not_planned", "Not planned"],
        ] as const
      ).map(([reason, label]) => (
        <button
          key={reason}
          type="button"
          onClick={() => value !== reason && onChange(reason)}
          aria-pressed={value === reason}
          className={cn(
            "px-2 py-0.5 text-xs leading-5 transition-colors",
            value === reason
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </span>
  );
}
