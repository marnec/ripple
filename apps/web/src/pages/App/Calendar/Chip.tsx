import { X } from "lucide-react";

/**
 * Shared chip component used in invitee pickers across the calendar
 * surface (CreateEventForm, EventDetail's InviteAdder, etc.). Each
 * chip displays a label and a trailing remove affordance.
 */
export function Chip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted text-foreground text-xs px-2 py-0.5">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground"
        aria-label={`Remove ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
