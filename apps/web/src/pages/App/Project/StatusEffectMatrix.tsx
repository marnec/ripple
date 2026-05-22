import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Inbox, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { AddColumnDialog } from "./AddColumnDialog";

type Status = Doc<"taskStatuses">;

/**
 * The Status Effect Matrix: one grid where rows are a project's statuses and
 * columns are the effects each status can carry. Singleton effects (default
 * landing, triage inbox) behave like radios — selecting one clears the
 * previous holder server-side. Toggle effects (completed, start-date) are
 * checkboxes. Mutually-exclusive cells are disabled with an explanatory
 * tooltip so the grid is self-describing.
 *
 * Triage is optional in general, but is a prerequisite for connecting a
 * GitHub repo — hence the helper line + anchor id consumed by the GitHub card.
 */
export function StatusEffectMatrix({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const statuses = useQuery(api.taskStatuses.listByProject, { projectId });
  const [addOpen, setAddOpen] = useState(false);

  if (statuses === undefined) {
    // Reserve space; no skeleton per UX guidelines.
    return <div className="min-h-[12rem]" id="status-effects" />;
  }

  const ordered = [...statuses].sort((a, b) => a.order - b.order);
  const hasTriage = ordered.some((s) => s.isTriage);

  return (
    <section className="mb-8 scroll-mt-20" id="status-effects">
      <h2 className="text-lg font-semibold mb-1">Status effects</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Assign what each status does. Some effects can apply to only one status.
      </p>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-left">
              <th className="py-2.5 pl-4 pr-2 font-medium">Status</th>
              <EffectHeader
                label="Default"
                hint="New tasks land here. Exactly one status is the default."
              />
              <EffectHeader
                label="Completed"
                hint="Tasks in this status count as done."
              />
              <EffectHeader
                label="Starts work"
                hint="Entering this status auto-sets the task's start date."
              />
              <EffectHeader
                label="Issue inbox"
                hint="Imported GitHub issues land here. Required to connect a repo."
              />
            </tr>
          </thead>
          <tbody>
            {ordered.map((status) => (
              <StatusRow key={status._id} status={status} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p
          className={cn(
            "text-xs",
            hasTriage ? "text-muted-foreground" : "text-amber-600 dark:text-amber-500",
          )}
        >
          {hasTriage ? (
            <>
              <Inbox className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
              Imported GitHub issues land in your issue-inbox status.
            </>
          ) : (
            "No issue inbox set — required before you can connect a GitHub repo."
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New status
        </Button>
      </div>

      <AddColumnDialog
        projectId={projectId}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </section>
  );
}

function EffectHeader({ label, hint }: { label: string; hint: string }) {
  return (
    <th className="px-2 py-2.5 text-center font-medium">
      <TooltipProvider delay={150}>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-4">
                {label}
              </span>
            }
          />
          <TooltipContent className="max-w-[14rem] text-center">
            {hint}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </th>
  );
}

function StatusRow({ status }: { status: Status }) {
  const setSingleton = useMutation(api.taskStatuses.setSingletonEffect);
  const update = useMutation(api.taskStatuses.update);

  const isTriage = status.isTriage === true;
  const setsStartDate = status.setsStartDate === true;

  const run = (p: Promise<unknown>) =>
    void p.catch((err: unknown) =>
      toast.error("Couldn't update status", {
        description: err instanceof Error ? err.message : "Please try again",
      }),
    );

  return (
    <>
      <tr className="border-b last:border-0">
        <td className="py-2.5 pl-4 pr-2">
          <span className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", status.color)} />
            <span className="font-medium">{status.name}</span>
          </span>
        </td>

        {/* Default — radio, exactly one, required */}
        <RadioCell
          selected={status.isDefault}
          disabledReason={isTriage ? "The issue inbox can't be the default" : undefined}
          onSelect={() =>
            status.isDefault
              ? undefined
              : run(setSingleton({ statusId: status._id, effect: "default", value: true }))
          }
        />

        {/* Completed — checkbox */}
        <CheckCell
          checked={status.isCompleted}
          disabledReason={
            isTriage
              ? "The issue inbox can't be completed"
              : setsStartDate
                ? "A status can't both start work and complete it"
                : undefined
          }
          onToggle={(v) => run(update({ statusId: status._id, isCompleted: v }))}
        />

        {/* Starts work — checkbox */}
        <CheckCell
          checked={setsStartDate}
          disabledReason={
            status.isCompleted ? "A completed status can't also start work" : undefined
          }
          onToggle={(v) => run(update({ statusId: status._id, setsStartDate: v }))}
        />

        {/* Triage — radio, at most one, optional (click selected to clear) */}
        <RadioCell
          selected={isTriage}
          disabledReason={
            status.isDefault
              ? "The default status can't be the inbox"
              : status.isCompleted
                ? "A completed status can't be the inbox"
                : undefined
          }
          onSelect={() =>
            run(
              setSingleton({
                statusId: status._id,
                effect: "triage",
                value: !isTriage,
              }),
            )
          }
        />
      </tr>

      {/* GitHub close-reason sub-row — only for completed statuses */}
      {status.isCompleted && (
        <tr className="border-b last:border-0 bg-muted/20">
          <td colSpan={5} className="py-2 pl-10 pr-4">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>When a GitHub-linked task closes here, mark it</span>
              <CloseReasonToggle
                value={status.externalCloseReason ?? "completed"}
                onChange={(reason) =>
                  run(update({ statusId: status._id, externalCloseReason: reason }))
                }
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function RadioCell({
  selected,
  disabledReason,
  onSelect,
}: {
  selected: boolean;
  disabledReason?: string;
  onSelect: () => void;
}) {
  const disabled = disabledReason !== undefined;
  const dot = (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "mx-auto flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
        selected
          ? "border-primary bg-primary"
          : "border-muted-foreground/40 hover:border-primary/60",
        disabled && "cursor-not-allowed opacity-30 hover:border-muted-foreground/40",
      )}
    >
      {selected && <span className="h-2 w-2 rounded-full bg-primary-foreground" />}
    </button>
  );
  return (
    <td className="px-2 py-2.5 text-center">
      {disabled ? <CellTooltip hint={disabledReason}>{dot}</CellTooltip> : dot}
    </td>
  );
}

function CheckCell({
  checked,
  disabledReason,
  onToggle,
}: {
  checked: boolean;
  disabledReason?: string;
  onToggle: (value: boolean) => void;
}) {
  const disabled = disabledReason !== undefined;
  const box = (
    <span className="mx-auto flex justify-center">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(c) => onToggle(c === true)}
        className={cn(disabled && "opacity-30")}
      />
    </span>
  );
  return (
    <td className="px-2 py-2.5 text-center">
      {disabled ? <CellTooltip hint={disabledReason}>{box}</CellTooltip> : box}
    </td>
  );
}

function CellTooltip({ hint, children }: { hint: string; children: React.ReactNode }) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex">{children}</span>} />
        <TooltipContent className="max-w-[14rem] text-center">{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CloseReasonToggle({
  value,
  onChange,
}: {
  value: "completed" | "not_planned";
  onChange: (value: "completed" | "not_planned") => void;
}) {
  return (
    <span className="inline-flex overflow-hidden rounded-md border">
      {(
        [
          ["completed", "Completed"],
          ["not_planned", "Won't do"],
        ] as const
      ).map(([reason, label]) => (
        <button
          key={reason}
          type="button"
          onClick={() => value !== reason && onChange(reason)}
          className={cn(
            "px-2 py-0.5 text-xs transition-colors",
            value === reason
              ? "bg-primary text-primary-foreground"
              : "hover:bg-accent",
          )}
        >
          {label}
        </button>
      ))}
    </span>
  );
}
