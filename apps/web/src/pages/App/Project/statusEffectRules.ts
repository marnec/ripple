import type { Doc } from "@convex/_generated/dataModel";

type Status = Pick<
  Doc<"taskStatuses">,
  "isDefault" | "isTriage" | "isCompleted" | "setsStartDate"
>;

export type StatusEffect = "default" | "triage" | "startsWork" | "completed";

export const STATUS_EFFECTS: {
  effect: StatusEffect;
  label: string;
  hint: string;
  /** Singleton effects are held by at most one status (radio semantics). */
  singleton: boolean;
}[] = [
  {
    effect: "default",
    label: "Default",
    hint: "New tasks land here. Exactly one status is the default.",
    singleton: true,
  },
  {
    effect: "triage",
    label: "Issue inbox",
    hint: "Imported GitHub issues land here. Required to connect a repo.",
    singleton: true,
  },
  {
    effect: "startsWork",
    label: "Starts work",
    hint: "Entering this status auto-sets the task's start date.",
    singleton: false,
  },
  {
    effect: "completed",
    label: "Completed",
    hint: "Tasks in this status count as done.",
    singleton: false,
  },
];

export function hasEffect(status: Status, effect: StatusEffect): boolean {
  switch (effect) {
    case "default":
      return status.isDefault;
    case "triage":
      return status.isTriage === true;
    case "startsWork":
      return status.setsStartDate === true;
    case "completed":
      return status.isCompleted;
  }
}

/**
 * Why `status` can't take `effect` right now, or `undefined` if it can. The
 * server enforces the same exclusions; this is what lets both the desktop
 * matrix and the mobile list explain a disabled control instead of just
 * greying it out.
 */
export function effectDisabledReason(
  status: Status,
  effect: StatusEffect,
): string | undefined {
  switch (effect) {
    case "default":
      return status.isTriage === true
        ? "The issue inbox can't be the default"
        : undefined;
    case "triage":
      if (status.isDefault) return "The default status can't be the inbox";
      if (status.isCompleted) return "A completed status can't be the inbox";
      return undefined;
    case "startsWork":
      return status.isCompleted
        ? "A completed status can't also start work"
        : undefined;
    case "completed":
      if (status.isTriage === true) return "The issue inbox can't be completed";
      if (status.setsStartDate === true)
        return "A status can't both start work and complete it";
      return undefined;
  }
}
