import { Check, ChevronDown, RefreshCw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Id } from "@convex/_generated/dataModel";
import type { CycleStatus } from "@ripple/shared/types/cycles";
import type { TaskScope } from "./taskScope";

type SelectableCycle = {
  _id: Id<"cycles">;
  name: string;
  status: CycleStatus;
  isCurrent: boolean;
  _creationTime: number;
};

/** Closed cycles listed in the menu; older ones stay reachable from the Cycles tab. */
const CLOSED_SHOWN = 5;

/**
 * Picks the cycle the Tasks tab shows: an open one (current first), or a
 * recently closed one for reference.
 */
export function CycleSelector({
  cycles,
  scope,
  onChange,
}: {
  cycles: SelectableCycle[];
  scope: TaskScope;
  onChange: (scope: TaskScope) => void;
}) {
  const open = cycles
    .filter((c) => c.status === "open")
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a._creationTime - b._creationTime);
  const closed = cycles
    .filter((c) => c.status === "closed")
    .sort((a, b) => b._creationTime - a._creationTime)
    .slice(0, CLOSED_SHOWN);

  const selected = scope.kind === "cycle" ? cycles.find((c) => c._id === scope.cycleId) : undefined;
  const label = selected?.name ?? "Cycle";

  const isSelected = (cycleId: Id<"cycles">) =>
    scope.kind === "cycle" && scope.cycleId === cycleId;

  const item = (c: SelectableCycle) => (
    <DropdownMenuItem
      key={c._id}
      onClick={() => onChange({ kind: "cycle", cycleId: c._id })}
      className="flex items-center gap-2"
    >
      <Check className={cn("size-3.5", !isSelected(c._id) && "invisible")} />
      <span className="truncate">{c.name}</span>
      {c.isCurrent && <span className="ml-auto pl-3 text-[11px] text-muted-foreground">current</span>}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium hover:bg-accent transition-colors cursor-pointer"
          />
        }
      >
        <RefreshCw className="size-3.5" />
        <span className="max-w-48 truncate">{label}</span>
        {selected?.status === "closed" && (
          <span className="text-[11px] font-normal text-muted-foreground">closed</span>
        )}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52 max-h-80 overflow-y-auto">
        {open.map(item)}
        {closed.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Closed</DropdownMenuLabel>
              {closed.map(item)}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
