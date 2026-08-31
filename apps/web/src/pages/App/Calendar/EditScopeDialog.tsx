/**
 * "What does this edit apply to?" — asked **on save**, never before.
 *
 * The organizer edits the occurrence in front of them and then says what the
 * edit meant; asking first would make them predict what they were about to
 * change. Presentation only: the parent holds the pending edit and decides
 * what each scope does with it.
 *
 * A rule edit applied to the whole series is the one destructive answer — the
 * original starts the overrides are filed under may not survive the new rule —
 * so its confirmation states how many customised occurrences will be reset
 * before the button is pressed.
 */
import { useState } from "react";

import { Check } from "lucide-react";

import { Button } from "@ripple/ui/components/button";
import { cn } from "@/lib/utils";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

import {
  resetNotice,
  scopeChoices,
  type EditKind,
  type EditScope,
  type OverrideCounts,
} from "./edit-scope";

export function EditScopeDialog({
  open,
  onOpenChange,
  kind,
  overrideCounts,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: EditKind;
  /** How many occurrences have been customised by hand — drives the warning. */
  overrideCounts: OverrideCounts;
  onConfirm: (scope: EditScope) => void;
}) {
  const choices = scopeChoices(kind);
  const [scope, setScope] = useState<EditScope>(choices[0].scope);
  const notice = resetNotice({ kind, scope, overrideCounts });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Apply this change to…</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            This meeting repeats. Choose what the edit applies to.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <div role="radiogroup" className="flex flex-col gap-2">
            {choices.map((choice) => (
              <button
                key={choice.scope}
                type="button"
                role="radio"
                aria-checked={scope === choice.scope}
                onClick={() => setScope(choice.scope)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors",
                  scope === choice.scope
                    ? "border-primary bg-primary/5"
                    : "border-border/60 hover:bg-muted/40",
                )}
              >
                <Check
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    scope === choice.scope
                      ? "text-primary"
                      : "text-transparent",
                  )}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{choice.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {choice.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {notice && (
            <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {notice}
            </p>
          )}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => onConfirm(scope)}>
            Save
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
