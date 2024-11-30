import {
  useCreateBlockNote,
  useEditorContentOrSelectionChange,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import {
  CodeIcon,
  FontBoldIcon,
  FontItalicIcon,
  Link1Icon,
  StrikethroughIcon,
  UnderlineIcon,
} from "@radix-ui/react-icons";
import { useTheme } from "next-themes";
import { FormEvent, useState } from "react";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { BlockNoteEditor } from "@blocknote/core";

interface MessageComposerProps {
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const editorIsEmpty = (editor: BlockNoteEditor) =>
  !editor._tiptapEditor.state.doc.textContent.trim().length;

export const MessageComposer: React.FunctionComponent<
  MessageComposerProps & React.HTMLAttributes<HTMLDivElement>
> = ({ handleSubmit }: MessageComposerProps) => {
  const { resolvedTheme } = useTheme();

  const editor = useCreateBlockNote({
    trailingBlock: false,
  });

  const [isBold, setIsBold] = useState(editor.getActiveStyles().bold);
  const [isItalic, setIsItalic] = useState(editor.getActiveStyles().italic);
  const [isStrike, setIsStrike] = useState(editor.getActiveStyles().strike);
  const [isCode, setIsCode] = useState(editor.getActiveStyles().code);
  const [isUnderline, setIsUnderline] = useState(
    editor.getActiveStyles().underline,
  );
  const [isEmpty, setIsEmpty] = useState(editorIsEmpty(editor));

  useEditorContentOrSelectionChange(() => {
    const { bold, italic, underline, strike, code } = editor.getActiveStyles();

    setIsBold(!!bold);
    setIsItalic(!!italic);
    setIsStrike(!!strike);
    setIsUnderline(!!underline);
    setIsCode(!!code);
    setIsEmpty(editorIsEmpty(editor));
  }, editor);

  return (
    <div className="flex flex-col p-2">
      <div className="flex flex-row gap-2">
        <Toggle
          variant="outline"
          size="sm"
          pressed={isBold}
          title="Bold (Ctrl + B)"
          onClick={() => {
            editor.toggleStyles({ bold: true });
            editor.focus();
          }}
        >
          <FontBoldIcon className="h-4 w-4" />
        </Toggle>

        <Toggle
          variant="outline"
          size="sm"
          title="Italic (Ctrl + I)"
          pressed={isItalic}
          onClick={() => {
            editor.toggleStyles({ italic: true });
            editor.focus();
          }}
        >
          <FontItalicIcon />
        </Toggle>

        <Toggle
          variant="outline"
          size="sm"
          title="Underline (Ctrl + U)"
          pressed={isUnderline}
          onClick={() => {
            editor.toggleStyles({ underline: true });
            editor.focus();
          }}
        >
          <UnderlineIcon />
        </Toggle>

        <Toggle
          variant="outline"
          size="sm"
          title="Strikethrough (Ctrl + Shift + S)"
          pressed={isStrike}
          onClick={() => {
            editor.toggleStyles({ strike: true });
            editor.focus();
          }}
        >
          <StrikethroughIcon />
        </Toggle>

        <Toggle
          variant="outline"
          size="sm"
          title="Code (Ctrl + ?)"
          pressed={isCode}
          onClick={() => {
            editor.toggleStyles({ code: true });
            editor.focus();
          }}
        >
          <CodeIcon />
        </Toggle>

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
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 py-4">
        <BlockNoteView
          editor={editor}
          className="w-full max-w-full border rounded-md px-2"
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          sideMenu={false}
          filePanel={false}
          emojiPicker={false}
          slashMenu={true}
          formattingToolbar={false}
        />
        <Button type="submit" disabled={isEmpty}>
          Send
        </Button>
      </form>
    </div>
  );
};
