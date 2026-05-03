import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@ripple/shared/types/routes";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { ChevronRight, Pencil, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DatePickerField } from "./DatePickerField";
import { EditCycleDialog } from "./EditCycleDialog";
import { CYCLE_STATUS_STYLES, formatDateRange } from "./cycleUtils";
import type { CycleStatus } from "@ripple/shared/types/cycles";

type CycleDoc = {
  _id: Id<"cycles">;
  name: string;
  description?: string;
  startDate?: string;
  dueDate?: string;
  status: CycleStatus;
  totalTasks: number;
  completedTasks: number;
  progressPercent: number;
};

export function ProjectCycles() {
  const { workspaceId, projectId } = useParams<QueryParams>();

  if (!workspaceId || !projectId) {
    return <SomethingWentWrong />;
  }

  return (
    <ProjectCyclesContent
      workspaceId={workspaceId}
      projectId={projectId}
    />
  );
}

function ProjectCyclesContent({
  workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const navigate = useNavigate();
  const cycles = useQuery(api.cycles.listByProject, { projectId });
  const [showCompleted, setShowCompleted] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingCycle, setEditingCycle] = useState<CycleDoc | null>(null);

  const active = cycles?.filter((c) => c.status === "active") ?? [];
  const upcoming = cycles
    ?.filter((c) => c.status === "upcoming")
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? "")) ?? [];
  const draft = cycles?.filter((c) => c.status === "draft") ?? [];
  const completed = cycles
    ?.filter((c) => c.status === "completed")
    .sort((a, b) => (b.dueDate ?? "").localeCompare(a.dueDate ?? "")) ?? [];

  const isEmpty = cycles !== undefined && cycles.length === 0;

  return (
    <div className="container mx-auto p-4">
      <div className="flex items-center justify-end mb-6">
        
        <Button size="sm" onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New cycle
        </Button>
      </div>

      {isEmpty && (
        <EmptyCyclesState />
      )}

      {active.length > 0 && (
        <CycleSection
          title="Active"
          cycles={active}
          onCycleClick={(id) => void navigate(id)}
          onEdit={(c) => setEditingCycle(c)}
        />
      )}
      {upcoming.length > 0 && (
        <CycleSection
          title="Upcoming"
          cycles={upcoming}
          onCycleClick={(id) => void navigate(id)}
          onEdit={(c) => setEditingCycle(c)}
        />
      )}
      {draft.length > 0 && (
        <CycleSection
          title="Draft"
          cycles={draft}
          onCycleClick={(id) => void navigate(id)}
          onEdit={(c) => setEditingCycle(c)}
        />
      )}

      {completed.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowCompleted((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2 hover:text-foreground transition-colors"
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform",
                showCompleted && "rotate-90"
              )}
            />
            Completed ({completed.length})
          </button>
          {showCompleted && (
            <CycleSection
              cycles={completed}
              onCycleClick={(id) => void navigate(id)}
              onEdit={(c) => setEditingCycle(c)}
            />
          )}
        </div>
      )}

      <CreateCycleDialog
        projectId={projectId}
        workspaceId={workspaceId}
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />

      {editingCycle && (
        <EditCycleDialog
          cycle={editingCycle}
          open={true}
          onOpenChange={(open) => { if (!open) setEditingCycle(null); }}
        />
      )}
    </div>
  );
}

function CycleSection({
  title,
  cycles,
  onCycleClick,
  onEdit,
}: {
  title?: string;
  cycles: CycleDoc[];
  onCycleClick: (id: string) => void;
  onEdit: (c: CycleDoc) => void;
}) {
  return (
    <div className="mb-6">
      {title && (
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          {title}
        </h3>
      )}
      <div className="space-y-2">
        {cycles.map((cycle) => (
          <CycleCard
            key={cycle._id}
            cycle={cycle}
            onClick={() => onCycleClick(cycle._id)}
            onEdit={() => onEdit(cycle)}
          />
        ))}
      </div>
    </div>
  );
}

function CycleCard({
  cycle,
  onClick,
  onEdit,
}: {
  cycle: CycleDoc;
  onClick: () => void;
  onEdit: () => void;
}) {
  const styles = CYCLE_STATUS_STYLES[cycle.status];
  const dateRange = formatDateRange(cycle.startDate, cycle.dueDate);

  return (
    <div className="group flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-accent transition-colors">
      {/* Left dot */}
      <span className={cn("w-2 h-2 rounded-full shrink-0", styles.dot)} />

      {/* Main content — clickable */}
      <button
        onClick={onClick}
        className="flex-1 min-w-0 text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{cycle.name}</span>
          {dateRange && (
            <span className="text-xs text-muted-foreground">{dateRange}</span>
          )}
        </div>

        {/* Progress bar (only if tasks exist) */}
        {cycle.totalTasks > 0 && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden max-w-40">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${cycle.progressPercent}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {cycle.completedTasks}/{cycle.totalTasks}
            </span>
          </div>
        )}
      </button>

      {/* Status badge */}
      <span
        className={cn(
          "text-xs font-medium px-2 py-0.5 rounded-full shrink-0",
          styles.badge
        )}
      >
        {cycle.status}
      </span>

      {/* Edit button — visible on hover */}
      <button
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-background"
        aria-label="Edit cycle"
      >
        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}

function EmptyCyclesState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <RotateCcw className="h-10 w-10 text-muted-foreground/40 mb-4" />
      <h3 className="font-semibold mb-1">No cycles yet</h3>
      <p className="text-sm text-muted-foreground max-w-xs mb-6">
        Cycles are time-boxed sprints that help you organize tasks into focused work periods.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Create Dialog
// ────────────────────────────────────────────────────────────────────────────

function CreateCycleForm({
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
        <Label htmlFor="cycle-name">Name</Label>
        <Input
          id="cycle-name"
          placeholder="Sprint 1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSave(); }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cycle-description">Description (optional)</Label>
        <Textarea
          id="cycle-description"
          placeholder="What's the focus of this cycle?"
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

function CreateCycleDialog({
  projectId,
  workspaceId,
  open,
  onOpenChange,
}: {
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createCycle = useMutation(api.cycles.create);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState<string | undefined>();
  const [dueDate, setDueDate] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setName("");
      setDescription("");
      setStartDate(undefined);
      setDueDate(undefined);
    }
    onOpenChange(open);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createCycle({
        projectId,
        workspaceId,
        name: name.trim(),
        description: description.trim() || undefined,
        startDate,
        dueDate,
      });
      handleOpenChange(false);
    } finally {
      setSaving(false);
    }
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

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange} direction="top">
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>New cycle</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="py-2">
          <CreateCycleForm {...formProps} />
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!name.trim() || saving}>
            Create cycle
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

