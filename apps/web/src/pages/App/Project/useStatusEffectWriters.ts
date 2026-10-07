import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import type { StatusEffect } from "./statusEffectRules";

export type CloseReason = "completed" | "not_planned";

function reportError(title: string) {
  return (err: unknown) =>
    toast.error(title, {
      description: err instanceof Error ? err.message : "Please try again",
    });
}

/**
 * One way to write a status effect, shared by the desktop matrix and the
 * mobile list. Singleton effects go through `setSingletonEffect` so the
 * previous holder is cleared server-side; toggles patch the status directly.
 */
export function useStatusEffectWriters() {
  const setSingleton = useMutation(api.taskStatuses.setSingletonEffect);
  const update = useMutation(api.taskStatuses.update);

  const setEffect = (
    status: Doc<"taskStatuses">,
    effect: StatusEffect,
    value: boolean,
  ) => {
    const write =
      effect === "default" || effect === "triage"
        ? setSingleton({ statusId: status._id, effect, value })
        : effect === "startsWork"
          ? update({ statusId: status._id, setsStartDate: value })
          : update({ statusId: status._id, isCompleted: value });
    void write.catch(reportError("Couldn't update status"));
  };

  const setCloseReason = (status: Doc<"taskStatuses">, reason: CloseReason) =>
    void update({ statusId: status._id, externalCloseReason: reason }).catch(
      reportError("Couldn't update close reason"),
    );

  return { setEffect, setCloseReason };
}
