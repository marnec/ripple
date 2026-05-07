import { CalendarDays, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Centered empty-state overlay shown over the calendar grid when the
 * viewer has no events and no tasks in the visible range. Keeps the
 * grid behind it (so the user sees what they're missing rather than a
 * blank rectangle) but offers a single CTA to start the create flow.
 */
export function EmptyOverlay({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-2 text-center bg-background/80 backdrop-blur-sm rounded-lg px-6 py-4 pointer-events-auto">
        <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">Nothing scheduled</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Plan a call or schedule a task to see it here.
        </p>
        <Button size="sm" variant="outline" onClick={onCreate} className="mt-1">
          <Plus className="h-3.5 w-3.5 mr-1" />
          New event
        </Button>
      </div>
    </div>
  );
}
