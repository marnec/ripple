import { Button } from "@ripple/ui/components/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { parseISODate, toISODateString } from "@/lib/task-utils";
import { CalendarIcon, X } from "lucide-react";

type DatePickerFieldProps = {
  value?: string;
  onChange: (date: string | null) => void;
  placeholder?: string;
  overdue?: boolean;
  /** Borderless trigger, for a property list (see `PROPERTY_TRIGGER_CLASS`). */
  ghost?: boolean;
  /** Open the calendar on mount — for a field the user just asked to add. */
  defaultOpen?: boolean;
};

export function DatePickerField({
  value,
  onChange,
  placeholder = "No date",
  overdue,
  ghost,
  defaultOpen,
}: DatePickerFieldProps) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Popover defaultOpen={defaultOpen}>
        <PopoverTrigger
          render={<Button
            variant={ghost ? "ghost" : "outline"}
            className={cn(
              "min-w-0 flex-1 justify-start text-left font-normal",
              ghost && "h-8 px-2.5 hover:bg-muted/60 aria-expanded:bg-muted/60 pointer-coarse:h-9",
              !value && "text-muted-foreground",
              overdue && "text-red-500",
              overdue && !ghost && "border-red-500/50",
            )}
          />}
        >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value
              ? parseISODate(value).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : placeholder}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value ? parseISODate(value) : undefined}
            onSelect={(date) =>
              onChange(date ? toISODateString(date) : null)
            }
          />
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 pointer-coarse:h-9 pointer-coarse:w-9"
          onClick={() => onChange(null)}
          aria-label="Clear date"
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
