import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { DatePickerField } from "./DatePickerField";

type CycleForEdit = {
  _id: Id<"cycles">;
  name: string;
  description?: string;
  startDate?: string;
  dueDate?: string;
  status: "draft" | "upcoming" | "active" | "completed";
};

function EditCycleForm({
  name,
  setName,
  description,
  setDescription,
  startDate,
  setStartDate,
  dueDate,
  setDueDate,
  onSave,
}: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  startDate: string | undefined;
  setStartDate: (v: string | undefined) => void;
  dueDate: string | undefined;
  setDueDate: (v: string | undefined) => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="edit-cycle-name">Name</Label>
        <Input
          id="edit-cycle-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSave(); }}
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-cycle-description">Description</Label>
        <Textarea
          id="edit-cycle-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="resize-none"
        />
      </div>

      <div className="flex gap-4">
        <div className="flex-1 space-y-1.5">
          <Label>Start date</Label>
          <DatePickerField
            value={startDate}
            onChange={(d) => setStartDate(d ?? undefined)}
            placeholder="Start date"
          />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label>Due date</Label>
          <DatePickerField
            value={dueDate}
            onChange={(d) => setDueDate(d ?? undefined)}
            placeholder="Due date"
          />
        </div>
      </div>
    </div>
  );
}

function DeleteButton({
  confirmDelete,
  onDelete,
}: {
  confirmDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onDelete}
      className={cn(
        "text-destructive hover:text-destructive hover:bg-destructive/10",
        confirmDelete && "bg-destructive/10"
      )}
    >
      <Trash2 className="h-4 w-4 mr-1" />
      {confirmDelete ? "Confirm delete" : "Delete"}
    </Button>
  );
}

export function EditCycleDialog({
  cycle,
  open,
  onOpenChange,
}: {
  cycle: CycleForEdit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const updateCycle = useMutation(api.cycles.update);
  const removeCycle = useMutation(api.cycles.remove);
  const [name, setName] = useState(cycle.name);
  const [description, setDescription] = useState(cycle.description ?? "");
  const [startDate, setStartDate] = useState<string | undefined>(cycle.startDate);
  const [dueDate, setDueDate] = useState<string | undefined>(cycle.dueDate);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await updateCycle({
        cycleId: cycle._id,
        name: name.trim(),
        description: description.trim() || null,
        startDate: startDate ?? null,
        dueDate: dueDate ?? null,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await removeCycle({ cycleId: cycle._id });
    onOpenChange(false);
  };

  const formProps = {
    name,
    setName,
    description,
    setDescription,
    startDate,
    setStartDate,
    dueDate,
    setDueDate,
    onSave: () => void handleSave(),
  };

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Edit cycle</DrawerTitle>
          </DrawerHeader>
          <div className="px-4">
            <EditCycleForm {...formProps} />
          </div>
          <DrawerFooter>
            <Button onClick={() => void handleSave()} disabled={!name.trim() || saving}>
              Save
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <DeleteButton confirmDelete={confirmDelete} onDelete={() => void handleDelete()} />
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit cycle</DialogTitle>
        </DialogHeader>

        <div className="py-2">
          <EditCycleForm {...formProps} />
        </div>

        <DialogFooter className="flex-row justify-between">
          <DeleteButton confirmDelete={confirmDelete} onDelete={() => void handleDelete()} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={!name.trim() || saving}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
