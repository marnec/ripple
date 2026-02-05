import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { en } from '@blocknote/core/locales';
import { useCreateBlockNote, useEditorChange, useEditorSelectionChange } from "@blocknote/react";
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
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Toggle } from "../../../components/ui/toggle";
import { useChatContext } from "./Chat";

interface MessageComposerProps {
  handleSubmit: (content: string, plainText: string) => void;
}

const editorIsEmpty = (editor: BlockNoteEditor<any>) =>
  !editor._tiptapEditor.state.doc.textContent.trim().length;

const editorClear = (editor: BlockNoteEditor<any>) => {
  editor.removeBlocks(editor.document.map((b) => b.id));
};

const { audio, image, heading, ...remainingBlockSpecs } = defaultBlockSpecs;
const schema = BlockNoteSchema.create({
  blockSpecs: { ...remainingBlockSpecs },
});

const dictionary = {
  ...en,
  placeholders: {
    ...en.placeholders,
    default: "Ctrl+Enter to send",
  },
};

export const MessageComposer: React.FunctionComponent<MessageComposerProps> = ({
  handleSubmit,
}: MessageComposerProps) => {
  const { resolvedTheme } = useTheme();
  const { editingMessage } = useChatContext();

  const editorConfig = useMemo(
    () => ({
      schema,
      trailingBlock: false,
      dictionary,
    }),
    [],
  );

  useEffect(() => {
    if (!editor?._tiptapEditor?.isInitialized) return;

    editor._tiptapEditor.commands.clearContent();

    if (editingMessage.id && editingMessage.body) {
      const document = editor.tryParseHTMLToBlocks(editingMessage.body)
      editor.replaceBlocks([editor.document[0].id], document);

    }
  }, [editingMessage]);

  const editor = useCreateBlockNote(editorConfig);

  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isStrike, setIsStrike] = useState(false);
  const [isCode, setIsCode] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  const sendMessage = async () => {
    if (isEmpty || !editor) return;
    const body = await editor.blocksToFullHTML(editor.document);
    const plainText = editor._tiptapEditor.getText();

    handleSubmit(body, plainText);
    editorClear(editor);
  };

  const updateActiveStyles = () => {
    if (!editor) return;
    const { bold, italic, underline, strike, code } = editor.getActiveStyles();
    setIsBold(!!bold);
    setIsItalic(!!italic);
    setIsStrike(!!strike);
    setIsUnderline(!!underline);
    setIsCode(!!code);
  };

  useEditorChange(() => {
    setIsEmpty(editorIsEmpty(editor));
    updateActiveStyles();
  }, editor);

  useEditorSelectionChange(() => {
    updateActiveStyles();
  }, editor);

  return (
    <div className="flex sm:flex-col flex-col-reverse p-2 max-w-full border-t">
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
        {/* <Button onClick={() => navigate("videocall")}>Call</Button> */}
      </div>
      <div className="flex gap-2 py-4">
        <BlockNoteView
          id="message-composer"
          editor={editor}
          className="w-full grow min-w-0 box-border border rounded-md px-2 transition-shadow focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1"
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          sideMenu={false}
          filePanel={false}
          emojiPicker={false}
          slashMenu={false}
          formattingToolbar={false}
          onKeyDownCapture={(event) => {
            if (!editor.getSelectedText()) {
              if (event.key === "b" && event.ctrlKey) setIsBold(!isBold);
              else if (event.key === "i" && event.ctrlKey) setIsItalic(!isItalic);
              else if (event.key === "u" && event.ctrlKey) setIsUnderline(!isUnderline);
              else if (event.key === "s" && event.ctrlKey && event.shiftKey) setIsStrike(!isStrike);
            }

            if (event.key === "Enter" && event.ctrlKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
        />
        <Button disabled={isEmpty} onClick={sendMessage} className="shrink-0 transition-transform active:scale-95">
          Send
        </Button>
      </div>
    </div>
  );
};
