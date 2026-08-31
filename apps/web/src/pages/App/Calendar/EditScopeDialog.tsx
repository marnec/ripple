/**
 * "What does this edit apply to?" — asked **on save**, never before.
 *
 * The organizer edits the occurrence in front of them and then says what the
 * edit meant; asking first would make them predict what they were about to
 * change. Presentation only: the parent holds the pending edit and decides
 * what each scope does with it.
 *
 * Every scope is always listed, and the ones this edit cannot use are shown
 * disabled with the reason in place of their description — a rule edit has no
 * single-occurrence meaning, and tags and invitations have no meaning narrower
 * than the series (ADR 0002). A list that quietly shrinks would leave the
 * organizer to guess which of those two it was.
 *
 * A rule edit applied to the whole series is the one destructive answer — the
 * original starts the overrides are filed under may not survive the new rule —
 * so its confirmation states how many customised occurrences will be reset
 * before the button is pressed.
 */
import { useState } from "react";

import { Check, Lock } from "lucide-react";

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
  defaultScope,
  resetNotice,
  scopeChoices,
  scopeQuestion,
  type EditKind,
  type EditScope,
  type OverrideCounts,
} from "./edit-scope";

export function EditScopeDialog({
  open,
  onOpenChange,
  kind,
  hasOccurrence = true,
  overrideCounts,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: EditKind;
  /** False on a series with no occurrence left, where only "all" has meaning. */
  hasOccurrence?: boolean;
  /** How many occurrences have been customised by hand — drives the warning. */
  overrideCounts: OverrideCounts;
  onConfirm: (scope: EditScope) => void;
}) {
  const choices = scopeChoices({ kind, hasOccurrence });
  const [scope, setScope] = useState<EditScope>(() => defaultScope(choices));
  const notice = resetNotice({ kind, scope, overrideCounts });
  const question = scopeQuestion(kind);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{question.title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{question.description}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <div role="radiogroup" className="flex flex-col gap-2">
            {choices.map((choice) => {
              const disabled = choice.disabledReason !== null;
              const selected = scope === choice.scope;
              return (
                <button
                  key={choice.scope}
                  type="button"
                  role="radio"
                  disabled={disabled}
                  aria-checked={selected}
                  onClick={() => setScope(choice.scope)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors",
                    disabled
                      ? "cursor-not-allowed border-border/40 opacity-60"
                      : selected
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:bg-muted/40",
                  )}
                >
                  {disabled ? (
                    <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Check
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        selected ? "text-primary" : "text-transparent",
                      )}
                    />
                  )}
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{choice.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {choice.disabledReason ?? choice.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {notice && (
            <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {notice}
            </p>
          )}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
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
