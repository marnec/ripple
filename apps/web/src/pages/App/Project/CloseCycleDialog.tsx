import { Button } from "@ripple/ui/components/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import type { FunctionArgs } from "convex/server";
import { Inbox, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

type Destination = FunctionArgs<typeof api.cycles.close>["unfinishedTo"];

/**
 * Close a cycle like a milestone. Completed tasks stay with it; the dialog
 * asks only where the unfinished ones go — and skips the question when there
 * are none.
 */
export function CloseCycleDialog({
  cycle,
  projectId,
  open,
  onOpenChange,
}: {
  cycle: { _id: Id<"cycles">; name: string; totalTasks: number; completedTasks: number };
  projectId: Id<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const closeCycle = useMutation(api.cycles.close);
  const cycles = useQuery(api.cycles.listByProject, open ? { projectId } : "skip");
  const others = (cycles ?? []).filter((c) => c.status === "open" && c._id !== cycle._id);
  const unfinished = cycle.totalTasks - cycle.completedTasks;

  // Carry-over is the common case, so default to the next open cycle, or a
  // fresh one when there is none.
  const fallback: Destination = others[0]
    ? { kind: "cycle", cycleId: others[0]._id }
    : { kind: "newCycle" };
  const [choice, setChoice] = useState<Destination | null>(null);
  const destination = choice ?? fallback;
  const [closing, setClosing] = useState(false);

  const isChosen = (d: Destination) =>
    d.kind === destination.kind &&
    (d.kind !== "cycle" || (destination.kind === "cycle" && d.cycleId === destination.cycleId));

  const handleClose = async () => {
    setClosing(true);
    try {
      await closeCycle({ cycleId: cycle._id, unfinishedTo: destination });
      onOpenChange(false);
    } catch (error) {
      toast.error("Could not close the cycle", {
        description: getErrorMessage(error),
      });
    } finally {
      setClosing(false);
    }
  };

  const options: { key: string; destination: Destination; icon: React.ReactNode; label: string }[] = [
    ...others.map((c) => ({
      key: c._id,
      destination: { kind: "cycle" as const, cycleId: c._id },
      icon: <RefreshCw className="size-4" />,
      label: c.name,
    })),
    { key: "new", destination: { kind: "newCycle" }, icon: <Plus className="size-4" />, label: "A new cycle" },
    { key: "backlog", destination: { kind: "backlog" }, icon: <Inbox className="size-4" />, label: "The backlog" },
  ];

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} direction="top">
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Close {cycle.name}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="py-2 space-y-3">
          {unfinished === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every task in this cycle is done. Its tasks stay with it as a record.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Completed tasks stay with the cycle. Move the{" "}
                <span className="font-medium text-foreground tabular-nums">{unfinished}</span>{" "}
                unfinished {unfinished === 1 ? "task" : "tasks"} to:
              </p>
              <div role="radiogroup" className="space-y-1.5">
                {options.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={isChosen(o.destination)}
                    onClick={() => setChoice(o.destination)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                      isChosen(o.destination)
                        ? "border-primary bg-primary/5"
                        : "hover:bg-accent",
                    )}
                  >
                    <span className="text-muted-foreground">{o.icon}</span>
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleClose()} disabled={closing || cycles === undefined}>
            Close cycle
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
