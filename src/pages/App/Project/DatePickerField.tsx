import { Button } from "@/components/ui/button";
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
};

export function DatePickerField({
  value,
  onChange,
  placeholder = "No date",
  overdue,
}: DatePickerFieldProps) {
  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !value && "text-muted-foreground",
              overdue && "text-red-500 border-red-500/50",
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value
              ? parseISODate(value).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value ? parseISODate(value) : undefined}
            onSelect={(date) =>
              onChange(date ? toISODateString(date) : null)
            }
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => onChange(null)}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
