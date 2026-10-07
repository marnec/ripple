import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@ripple/ui/components/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { getErrorMessage } from "@/lib/errors";

/**
 * Rename a resource from a phone: a bottom sheet with a full-width field that
 * wraps, opened from the header title (`MobileHeaderTitle`). The header is
 * too narrow to edit a sentence-long task title in place, and every other
 * property on a phone is already a tap that opens a sheet.
 *
 * Same rules as `InlineTitleField`: trimmed, and an empty or unchanged name
 * commits nothing. Unlike the inline field, a failed rename keeps the sheet
 * open with the draft, so the user can fix it (a document name already taken)
 * instead of retyping it. `onRename` may reject (toasted here) or resolve to
 * `false` after reporting the failure itself (the task's `patch`).
 */
export function RenameSheet({
  open,
  onOpenChange,
  value,
  onRename,
  resourceLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onRename: (name: string) => Promise<unknown> | void;
  /** "task", "document"… — names the sheet. */
  resourceLabel: string;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerTitle className="px-4 pt-3 text-sm font-medium">Rename {resourceLabel}</DrawerTitle>
        {/* Mounted only while open, so every opening starts from the current
            name rather than an abandoned draft. */}
        {open && (
          <RenameForm
            value={value}
            onRename={onRename}
            onDone={() => onOpenChange(false)}
            resourceLabel={resourceLabel}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}

function RenameForm({
  value,
  onRename,
  onDone,
  resourceLabel,
}: {
  value: string;
  onRename: (name: string) => Promise<unknown> | void;
  onDone: () => void;
  resourceLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const name = draft.trim();

  const save = async () => {
    if (!name || name === value) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      const result = await onRename(name);
      if (result !== false) onDone();
    } catch (error: unknown) {
      toast.error("Could not rename", { description: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-3 p-4 pb-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <textarea
        // The sheet exists to type into, so it opens with the keyboard up.
        autoFocus
        rows={1}
        value={draft}
        // A name is one line of data: newlines from a paste fold into spaces,
        // and Enter submits instead of breaking the line.
        onChange={(e) => setDraft(e.target.value.replace(/\s*\n\s*/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        onFocus={(e) => e.currentTarget.select()}
        aria-label={`${resourceLabel} name`}
        enterKeyHint="done"
        className="field-sizing-content w-full resize-none rounded-md border bg-transparent px-3 py-2 text-base font-semibold outline-none focus-visible:border-foreground/25"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name || saving}>
          Save
        </Button>
      </div>
    </form>
  );
}
