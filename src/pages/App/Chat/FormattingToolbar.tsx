import type { BlockNoteEditor } from "@blocknote/core";
import { useEditorChange, useEditorSelectionChange } from "@blocknote/react";
import {
  CodeIcon,
  FontBoldIcon,
  FontItalicIcon,
  Link1Icon,
  StrikethroughIcon,
  UnderlineIcon,
} from "@radix-ui/react-icons";
import { ImageIcon, Phone } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Toggle } from "../../../components/ui/toggle";

type StyleKey = "bold" | "italic" | "underline" | "strike" | "code";

const STYLE_TOGGLES: {
  key: StyleKey;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}[] = [
  { key: "bold", icon: FontBoldIcon, title: "Bold (Ctrl + B)" },
  { key: "italic", icon: FontItalicIcon, title: "Italic (Ctrl + I)" },
  { key: "underline", icon: UnderlineIcon, title: "Underline (Ctrl + U)" },
  { key: "strike", icon: StrikethroughIcon, title: "Strikethrough (Ctrl + Shift + S)" },
  { key: "code", icon: CodeIcon, title: "Code (Ctrl + ?)" },
];

type FormattingToolbarProps = {
  editor: BlockNoteEditor<any, any, any>;
  uploadFile?: (file: File) => Promise<string>;
  onAttachImage: (url: string) => void;
  onUploadStart?: () => void;
  onUploadEnd?: () => void;
  showCallButton?: boolean;
  onStartCall?: () => void;
};

export function FormattingToolbar({
  editor,
  uploadFile,
  onAttachImage,
  onUploadStart,
  onUploadEnd,
  showCallButton,
  onStartCall,
}: FormattingToolbarProps) {
  const [activeStyles, setActiveStyles] = useState<Record<StyleKey, boolean>>({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    code: false,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const syncStyles = useCallback(() => {
    const styles = editor.getActiveStyles();
    setActiveStyles({
      bold: !!styles.bold,
      italic: !!styles.italic,
      underline: !!styles.underline,
      strike: !!styles.strike,
      code: !!styles.code,
    });
  }, [editor]);

  useEditorSelectionChange(syncStyles, editor);
  useEditorChange(syncStyles, editor);

  const handleAttachImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadFile) return;
    onUploadStart?.();
    try {
      const url = await uploadFile(file);
      onAttachImage(url);
    } catch (err) {
      console.error("Image upload failed:", err);
    } finally {
      onUploadEnd?.();
    }
    e.target.value = "";
  };

  return (
    <div className="flex justify-between items-start">
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

        <Button
          variant="outline"
          size="sm"
          title="Link (Ctrl + K)"
          onClick={() => {
            const text = editor.getSelectedText();
            const link = editor.getSelectedLinkUrl();
            editor.createLink(link ?? text, text);
            editor.focus();
          }}
        >
          <Link1Icon />
        </Button>

        <Button
          variant="outline"
          size="sm"
          title="Attach image"
          disabled={!uploadFile}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageIcon className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handleAttachImage(e)}
        />
      </div>
      {showCallButton && onStartCall && (
        <Button variant="ghost" size="icon" onClick={onStartCall} title="Start a call">
          <Phone className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
