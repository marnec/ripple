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
import { generateThumbnail } from "@/lib/image-thumbnail";
import type { ImageUploadResult } from "../../../hooks/use-upload-file";

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
  uploadImageWithThumbnail?: (original: File, thumbnail: File, isOriginal: boolean) => Promise<ImageUploadResult>;
  onImagePreview: (blobUrl: string) => void;
  onImageReady: (urls: ImageUploadResult) => void;
  onImageUploadFailed: () => void;
  showCallButton?: boolean;
  onStartCall?: () => void;
};

export function FormattingToolbar({
  editor,
  uploadImageWithThumbnail,
  onImagePreview,
  onImageReady,
  onImageUploadFailed,
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
    if (!file || !uploadImageWithThumbnail) return;
    try {
      const { thumbnail, previewUrl, isOriginal } = await generateThumbnail(file);
      onImagePreview(previewUrl);
      const urls = await uploadImageWithThumbnail(file, thumbnail, isOriginal);
      onImageReady(urls);
    } catch (err) {
      console.error("Image upload failed:", err);
      onImageUploadFailed();
    }
    e.target.value = "";
  };

  return (
    <div className="flex justify-between items-center">
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
          disabled={!uploadImageWithThumbnail}
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
        <Button variant="ghost" size="icon" onClick={onStartCall} title="Start a call" className="sm:w-18 sm:gap-1.5 sm:px-3">
          <Phone className="h-4 w-4" />
          <span className="hidden sm:inline text-sm">Join</span>
        </Button>
      )}
    </div>
  );
}
