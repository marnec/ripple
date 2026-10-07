import { Pencil } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { useTitleDraft } from "@/hooks/use-title-draft";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * A resource's name, edited where it is shown: the toolbar title of every
 * surface and of the full task page. Reads as heading text until hovered or
 * focused; one line, truncated with an ellipsis when it does not fit.
 *
 * Enter or blur commits, Escape reverts. An empty or unchanged value commits
 * nothing. A rejected commit (a document name already taken, say) is toasted
 * and the field falls back to the server's name — the draft never silently
 * claims a rename that did not happen. A commit that resolves to `false` has
 * already told the user itself (the task's `patch` does); the field only
 * reverts.
 */
export function InlineTitleField({
  value,
  onCommit,
  ariaLabel,
  placeholder = "Untitled",
  fill = false,
  className,
}: {
  /** The server's current name. The field follows it when it changes. */
  value: string;
  /** Reject, or resolve to `false` once the failure is reported, to revert. */
  onCommit: (name: string) => Promise<unknown> | void;
  ariaLabel: string;
  placeholder?: string;
  /**
   * Take the container's whole width instead of hugging the text, so a long
   * name truncates at the container's edge rather than at its own length.
   * Without the negative margin the hug mode uses to align the hover tint.
   */
  fill?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useTitleDraft(value);
  // Escape blurs too, and the blur handler must not commit what was abandoned.
  const discardRef = useRef(false);

  const commit = () => {
    if (discardRef.current) {
      discardRef.current = false;
      setDraft(value);
      return;
    }
    const name = draft.trim();
    if (!name || name === value) {
      setDraft(value);
      return;
    }
    setDraft(name);
    void Promise.resolve(onCommit(name)).then(
      (result) => {
        if (result === false) setDraft(value);
      },
      (error: unknown) => {
        toast.error("Could not rename", { description: getErrorMessage(error) });
        setDraft(value);
      },
    );
  };

  // A label, so a click anywhere on it — the pencil included — lands in the
  // input. On hover the pencil and pointer say "editable"; at rest the title
  // reads as plain text, and while editing both give way to the caret. The
  // pencil fades rather than unmounting, so hovering never shifts the layout.
  return (
    <label
      className={cn(
        "group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 hover:bg-muted/40 focus-within:cursor-text focus-within:bg-muted/40",
        fill ? "w-full" : "-mx-1.5 max-w-full",
        className,
      )}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            discardRef.current = true;
            e.currentTarget.blur();
          }
        }}
        aria-label={ariaLabel}
        placeholder={placeholder}
        spellCheck={false}
        className={cn(
          "min-w-0 cursor-pointer truncate bg-transparent outline-none placeholder:text-muted-foreground focus:cursor-text",
          fill ? "flex-1" : "field-sizing-content min-w-16",
        )}
      />
      <Pencil
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:hidden"
      />
    </label>
  );
}
