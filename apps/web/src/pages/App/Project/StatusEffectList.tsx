import { Button } from "@ripple/ui/components/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, ChevronRight, ChevronUp, Plus } from "lucide-react";
import { useState } from "react";
import type { Doc } from "@convex/_generated/dataModel";
import { CloseReasonToggle } from "./CloseReasonToggle";
import { useStatusEffectWriters } from "./useStatusEffectWriters";
import {
  effectDisabledReason,
  hasEffect,
  STATUS_EFFECTS,
  type StatusEffect,
} from "./statusEffectRules";

type Status = Doc<"taskStatuses">;

/**
 * Mobile counterpart of the Status Effect Matrix. The matrix's short axis is
 * effects (always four) and its long axis is statuses (unbounded), so on a
 * narrow screen it's transposed: one row per effect showing who holds it, and
 * a picker sheet to change that. Constraints that the matrix explains through
 * hover tooltips are spelled out inline in the picker, since touch has no
 * hover. Reordering moves to its own list with full-size tap targets, shown
 * first so the effect pickers below read against the order just set.
 */
export function StatusEffectList({
  statuses,
  onMove,
  onAddStatus,
}: {
  statuses: Status[];
  onMove: (index: number, direction: -1 | 1) => void;
  onAddStatus: () => void;
}) {
  const { setCloseReason } = useStatusEffectWriters();
  // Kept after close so the sheet's exit animation still has content.
  const [picking, setPicking] = useState<StatusEffect>("default");
  const [pickerOpen, setPickerOpen] = useState(false);
  const completed = statuses.filter((s) => s.isCompleted);

  return (
    <>
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Statuses</h2>
        <ul className="divide-y rounded-lg border">
          {statuses.map((status, i) => (
            <li key={status._id} className="flex items-center gap-2 pl-4 pr-1">
              <StatusLabel status={status} className="flex-1 py-3" />
              <Button
                variant="ghost"
                size="icon"
                className="size-11 text-muted-foreground"
                aria-label={`Move ${status.name} up`}
                disabled={i === 0}
                onClick={() => onMove(i, -1)}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-11 text-muted-foreground"
                aria-label={`Move ${status.name} down`}
                disabled={i === statuses.length - 1}
                onClick={() => onMove(i, 1)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="outline" className="mt-3 w-full gap-1.5" onClick={onAddStatus}>
          <Plus className="h-4 w-4" />
          New status
        </Button>
      </section>

      <section className="mb-8" id="status-effects">
        <h2 className="text-lg font-semibold mb-3">Status effects</h2>
        <div className="divide-y rounded-lg border">
          {STATUS_EFFECTS.map(({ effect, label, hint }) => {
            const holders = statuses.filter((s) => hasEffect(s, effect));
            const missingInbox = effect === "triage" && holders.length === 0;
            return (
              <div key={effect}>
                <button
                  type="button"
                  onClick={() => {
                    setPicking(effect);
                    setPickerOpen(true);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{label}</span>
                    <span
                      className={cn(
                        "block text-xs",
                        missingInbox
                          ? "text-amber-600 dark:text-amber-500"
                          : "text-muted-foreground",
                      )}
                    >
                      {missingInbox ? "Required before you can connect a GitHub repo" : hint}
                    </span>
                  </span>
                  <StatusNames statuses={holders} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>

                {/* GitHub close reason only exists for completed statuses, so
                    it lives under the effect that creates them. */}
                {effect === "completed" && completed.length > 0 && (
                  <div className="space-y-2 px-4 pb-3">
                    <p className="text-xs text-muted-foreground">
                      Close linked GitHub issue as
                    </p>
                    {completed.map((status) => (
                      <div key={status._id} className="flex items-center justify-between gap-3">
                        <StatusLabel status={status} />
                        <CloseReasonToggle
                          className="mx-0"
                          value={status.externalCloseReason ?? "completed"}
                          onChange={(reason) => setCloseReason(status, reason)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <EffectPicker
        effect={picking}
        open={pickerOpen}
        statuses={statuses}
        onOpenChange={setPickerOpen}
      />
    </>
  );
}

function StatusNames({ statuses }: { statuses: Status[] }) {
  if (statuses.length === 0) {
    return <span className="text-sm text-muted-foreground">None</span>;
  }
  return (
    <span className="max-w-[45%] truncate text-right text-sm">
      {statuses.map((s) => s.name).join(", ")}
    </span>
  );
}

function StatusLabel({ status, className }: { status: Status; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2 text-sm", className)}>
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", status.color)} />
      <span className="truncate font-medium">{status.name}</span>
    </span>
  );
}

/**
 * Sheet for choosing which statuses hold one effect. Writes are immediate —
 * same as the matrix — so the sheet doubles as live feedback: picking a new
 * default visibly moves the checkmark, and exclusions update as you go.
 */
function EffectPicker({
  effect,
  open,
  statuses,
  onOpenChange,
}: {
  effect: StatusEffect;
  open: boolean;
  statuses: Status[];
  onOpenChange: (open: boolean) => void;
}) {
  const { setEffect } = useStatusEffectWriters();
  const meta = STATUS_EFFECTS.find((e) => e.effect === effect)!;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{meta.label}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {meta.hint}
            {meta.singleton ? "" : " Applies to any number of statuses."}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="pb-6">
          <ul className="divide-y rounded-lg border">
            {statuses.map((status) => {
              const selected = hasEffect(status, meta.effect);
              // A held effect can always be released; the exclusion only
              // blocks *taking* it.
              const reason = selected
                ? undefined
                : effectDisabledReason(status, meta.effect);
              // The default is required — tapping the current holder is a
              // no-op rather than leaving the project without one.
              const locked = meta.effect === "default" && selected;
              return (
                <li key={status._id}>
                  <button
                    type="button"
                    disabled={reason !== undefined}
                    aria-pressed={selected}
                    onClick={() => !locked && setEffect(status, meta.effect, !selected)}
                    className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-accent disabled:active:bg-transparent"
                  >
                    <span className="min-w-0 flex-1">
                      <StatusLabel
                        status={status}
                        className={cn(reason !== undefined && "opacity-50")}
                      />
                      {reason !== undefined && (
                        <span className="mt-0.5 block pl-4.5 text-xs text-muted-foreground">
                          {reason}
                        </span>
                      )}
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {meta.effect === "triage" && (
            <p className="mt-3 text-xs text-muted-foreground">
              Tap the selected status again to clear the inbox.
            </p>
          )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
