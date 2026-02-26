import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

type AddColumnDialogProps = {
  projectId: Id<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const COLORS = [
  { name: "Blue", class: "bg-blue-500" },
  { name: "Green", class: "bg-green-500" },
  { name: "Yellow", class: "bg-yellow-500" },
  { name: "Red", class: "bg-red-500" },
  { name: "Purple", class: "bg-purple-500" },
  { name: "Pink", class: "bg-pink-500" },
  { name: "Orange", class: "bg-orange-500" },
  { name: "Teal", class: "bg-teal-500" },
];

export function AddColumnDialog({
  projectId,
  open,
  onOpenChange,
}: AddColumnDialogProps) {
  const [name, setName] = useState("");
  const [selectedColor, setSelectedColor] = useState("bg-blue-500");
  const [isCompleted, setIsCompleted] = useState(false);
  const [setsStartDate, setSetsStartDate] = useState(false);

  // @ts-expect-error — TS2589: deep type instantiation from Convex schema size
  const createStatus = useMutation(api.taskStatuses.create);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) return;

    void createStatus({
      projectId,
      name: trimmedName,
      color: selectedColor,
      isCompleted,
      setsStartDate,
    }).then(() => {
      // Reset form and close dialog
      setName("");
      setSelectedColor("bg-blue-500");
      setIsCompleted(false);
      setSetsStartDate(false);
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Column</DialogTitle>
          <DialogDescription>
            Create a new status column for your project.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* Name Input */}
            <div className="space-y-2">
              <Label htmlFor="column-name">Name</Label>
              <Input
                id="column-name"
                placeholder="e.g. Review, QA, Blocked"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {/* Color Picker */}
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {COLORS.map((color) => (
                  <button
                    key={color.class}
                    type="button"
                    className={cn(
                      "w-8 h-8 rounded-full transition-all",
                      color.class,
                      selectedColor === color.class
                        ? "ring-2 ring-offset-2 ring-primary"
                        : "hover:scale-110"
                    )}
                    onClick={() => setSelectedColor(color.class)}
                    title={color.name}
                  />
                ))}
              </div>
            </div>

            {/* Completion Toggle */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="is-completed"
                checked={isCompleted}
                onCheckedChange={(checked) => {
                  setIsCompleted(checked === true);
                  if (checked) setSetsStartDate(false);
                }}
              />
              <Label
                htmlFor="is-completed"
                className="text-sm font-normal cursor-pointer"
              >
                Marks tasks as completed
              </Label>
            </div>

            {/* Start Date Toggle */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="sets-start-date"
                checked={setsStartDate}
                disabled={isCompleted}
                onCheckedChange={(checked) => setSetsStartDate(checked === true)}
              />
              <Label
                htmlFor="sets-start-date"
                className={cn(
                  "text-sm font-normal cursor-pointer",
                  isCompleted && "text-muted-foreground"
                )}
              >
                Sets start date for tasks
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Create Column</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
