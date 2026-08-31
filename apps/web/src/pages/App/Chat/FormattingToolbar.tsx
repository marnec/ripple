import type { BlockNoteEditor } from "@blocknote/core";
import { useEditorChange, useEditorSelectionChange } from "@blocknote/react";
import {
  BoldIcon,
  CodeIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@ripple/ui/components/button";
import { Input } from "@ripple/ui/components/input";
import { normalizeLinkUrl } from "@/lib/link-url";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Toggle } from "../../../components/ui/toggle";

type StyleKey = "bold" | "italic" | "underline" | "strike" | "code";

const STYLE_TOGGLES: {
  key: StyleKey;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}[] = [
  { key: "bold", icon: BoldIcon, title: "Bold (Ctrl + B)" },
  { key: "italic", icon: ItalicIcon, title: "Italic (Ctrl + I)" },
  { key: "underline", icon: UnderlineIcon, title: "Underline (Ctrl + U)" },
  { key: "strike", icon: StrikethroughIcon, title: "Strikethrough (Ctrl + Shift + S)" },
  { key: "code", icon: CodeIcon, title: "Code (Ctrl + ?)" },
];

type Editor = BlockNoteEditor<any, any, any>;

/**
 * What the link button acts on, read fresh from the editor's selection.
 *
 * - `edit` — the caret sits in an existing link. This is also the button's
 *   pressed state, so the toolbar says "you are in a link" the way the style
 *   toggles say "you are in bold", and the popover edits that link instead of
 *   nesting a second one inside it.
 * - `wrap` — text is selected; it becomes the link's label.
 * - `insert` — nothing is selected, so there is nothing to turn into a link and
 *   the popover asks for the text to insert as well. (Before, the button was
 *   simply dead here: `createLink("", "")` is a no-op inside BlockNote.)
 */
type LinkTarget =
  | { kind: "edit"; url: string; text: string; pos: number }
  | { kind: "wrap"; text: string }
  | { kind: "insert" };

function readLinkTarget(editor: Editor): LinkTarget {
  const mark = editor.getLinkMarkAtPos(editor.prosemirrorState.selection.from);
  if (mark) return { kind: "edit", url: mark.href, text: mark.text, pos: mark.from };
  const selected = editor.getSelectedText();
  return selected ? { kind: "wrap", text: selected } : { kind: "insert" };
}

const INVALID_URL_MESSAGE = "Enter a full address, like https://example.com";

function LinkButton({ editor }: { editor: Editor }) {
  const [target, setTarget] = useState<LinkTarget>({ kind: "insert" });
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const syncTarget = () => setTarget(readLinkTarget(editor));
  useEditorSelectionChange(syncTarget, editor);
  useEditorChange(syncTarget, editor);

  // The selection is snapshotted as the popover opens: the fields are seeded
  // from it, and `pos` outlives the editor losing focus to the form.
  const openEditor = () => {
    const next = readLinkTarget(editor);
    setTarget(next);
    setUrl(next.kind === "edit" ? next.url : "");
    setText(next.kind === "edit" ? next.text : "");
    setError(null);
    setOpen(true);
  };

  const apply = () => {
    const href = normalizeLinkUrl(url);
    if (!href) {
      setError(INVALID_URL_MESSAGE);
      return;
    }
    const label = text.trim() || href;
    if (target.kind === "edit") editor.editLink(href, label, target.pos);
    else if (target.kind === "wrap") editor.createLink(href);
    else editor.createLink(href, label);
    setOpen(false);
    editor.focus();
  };

  const removeLink = () => {
    if (target.kind === "edit") editor.deleteLink(target.pos);
    setOpen(false);
    editor.focus();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) return openEditor();
        // Dismissed with Escape or a click away: hand the caret back to the
        // message being written, which `finalFocus={false}` leaves to us.
        setOpen(false);
        editor.focus();
      }}
    >
      <PopoverTrigger
        render={
          <Toggle
            variant="outline"
            size="sm"
            pressed={target.kind === "edit"}
            title="Link"
            aria-label="Link"
          />
        }
      >
        <LinkIcon className="h-4 w-4" />
      </PopoverTrigger>
      {/* Above the toolbar: the composer sits at the bottom of the screen, so a
          popover on the default side would cover the message being written.
          `finalFocus={false}` leaves the caret where `apply` put it instead of
          bouncing focus back to the trigger. */}
      <PopoverContent side="top" align="start" finalFocus={false} className="w-80">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <Input
            value={url}
            aria-label="Link URL"
            aria-invalid={!!error}
            placeholder="https://example.com"
            onChange={(event) => {
              setUrl(event.currentTarget.value);
              setError(null);
            }}
          />
          {target.kind !== "wrap" && (
            <Input
              value={text}
              aria-label="Link text"
              placeholder="Text to display"
              onChange={(event) => setText(event.currentTarget.value)}
            />
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            {target.kind === "edit" && (
              <Button type="button" variant="ghost" size="sm" onClick={removeLink}>
                Remove
              </Button>
            )}
            <Button type="submit" size="sm">
              {target.kind === "edit" ? "Save" : "Add link"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

type FormattingToolbarProps = {
  editor: Editor;
  /** Whether image attachment is available (upload backend ready). */
  canAttachImage: boolean;
  /** Hand a picked image file to the composer's shared attachment flow. */
  onAttachImage: (file: File) => void;
};

export function FormattingToolbar({
  editor,
  canAttachImage,
  onAttachImage,
}: FormattingToolbarProps) {
  const [activeStyles, setActiveStyles] = useState<Record<StyleKey, boolean>>({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    code: false,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const syncStyles = () => {
    const styles = editor.getActiveStyles();
    setActiveStyles({
      bold: !!styles.bold,
      italic: !!styles.italic,
      underline: !!styles.underline,
      strike: !!styles.strike,
      code: !!styles.code,
    });
  };

  useEditorSelectionChange(syncStyles, editor);
  useEditorChange(syncStyles, editor);

  const handleAttachImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onAttachImage(file);
    e.target.value = "";
  };

  return (
    <div className="flex flex-row gap-2">
      {STYLE_TOGGLES.map(({ key, icon: Icon, title }) => (
        <Toggle
          key={key}
          variant="outline"
          size="sm"
          pressed={activeStyles[key]}
          title={title}
          onClick={() => {
            editor.toggleStyles({ [key]: true });
            setActiveStyles((prev) => ({ ...prev, [key]: !prev[key] }));
            editor.focus();
          }}
        >
          <Icon className="h-4 w-4" />
        </Toggle>
      ))}

      <LinkButton editor={editor} />

      <Button
        variant="outline"
        size="sm"
        title="Attach image"
        disabled={!canAttachImage}
        onClick={() => fileInputRef.current?.click()}
      >
        <ImageIcon className="h-4 w-4" />
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAttachImage}
      />
    </div>
  );
}
