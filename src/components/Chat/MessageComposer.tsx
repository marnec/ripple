import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  locales,
} from "@blocknote/core";
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
import { useState } from "react";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { useNavigate } from "react-router-dom";

interface MessageComposerProps {
  handleSubmit: (content: string) => void;
}

const editorIsEmpty = (editor: BlockNoteEditor<any>) =>
  !editor._tiptapEditor.state.doc.textContent.trim().length;

const editorClear = (editor: BlockNoteEditor<any>) => {
  editor.removeBlocks(editor.document.map((b) => b.id));
};

export const MessageComposer: React.FunctionComponent<MessageComposerProps> = ({
  handleSubmit,
}: MessageComposerProps) => {
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();

  const { audio, image, heading, ...remainingBlockSpecs } = defaultBlockSpecs;
  const schema = BlockNoteSchema.create({
    blockSpecs: { ...remainingBlockSpecs },
  });

  const dictionary = locales.en;
  dictionary.placeholders.default = "Enter for newline; Ctrl+Enter to send";
  const editor = useCreateBlockNote({
    schema,
    trailingBlock: false,
    dictionary,
  });

  const [isBold, setIsBold] = useState(editor.getActiveStyles().bold);
  const [isItalic, setIsItalic] = useState(editor.getActiveStyles().italic);
  const [isStrike, setIsStrike] = useState(editor.getActiveStyles().strike);
  const [isCode, setIsCode] = useState(editor.getActiveStyles().code);
  const [isUnderline, setIsUnderline] = useState(
    editor.getActiveStyles().underline,
  );
  const [isEmpty, setIsEmpty] = useState(editorIsEmpty(editor));

  const sendMessage = () => {
    if (isEmpty) return;
    handleSubmit(JSON.stringify(editor.document));
    editorClear(editor);
  };

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
      <div className="flex justify-between items-start">
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
        <Button onClick={() => navigate("videocall")}>Call</Button>
      </div>
      <div className="flex gap-2 py-4">
        <BlockNoteView
          editor={editor}
          className="w-full max-w-full border rounded-md px-2"
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          sideMenu={false}
          filePanel={false}
          emojiPicker={false}
          slashMenu={false}
          formattingToolbar={false}
          onKeyDownCapture={(event) => {
            if (!editor.getSelectedText()) {
              if (event.key === "b" && event.ctrlKey) setIsBold(!isBold);
              else if (event.key === "i" && event.ctrlKey)
                setIsItalic(!isItalic);
              else if (event.key === "u" && event.ctrlKey)
                setIsUnderline(!isUnderline);
              else if (event.key === "s" && event.ctrlKey && event.shiftKey)
                setIsStrike(!isStrike);
            }

            if (event.key === "Enter" && event.ctrlKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
        />
        <Button disabled={isEmpty} onClick={sendMessage}>
          Send
        </Button>
      </div>
    </div>
  );
};
