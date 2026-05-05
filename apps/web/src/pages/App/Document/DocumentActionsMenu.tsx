import { useState } from "react";
import { Code2, FileText, FileType2, Share2 } from "lucide-react";
import { toast } from "sonner";
import type { BlockNoteEditor } from "@blocknote/core";
import { useConvex } from "convex/react";
import { ShareDialog } from "@/components/ShareDialog";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuSeparator,
  ResponsiveDropdownMenuTrigger,
} from "@/components/ui/responsive-dropdown-menu";
import type { Id } from "@convex/_generated/dataModel";

type DocumentExporters = typeof import("@/lib/exporters/document");
// Single dynamic import shared across the three format buttons. Keeps the
// `@/lib/exporters/document` module (and its block-walker) out of the
// DocumentEditor route chunk until the user opens the menu and exports.
const loadExporters = (): Promise<DocumentExporters> => import("@/lib/exporters/document");

interface DocumentActionsMenuProps {
  documentId: Id<"documents">;
  documentName: string;
  isAdmin: boolean;
  editor: BlockNoteEditor<any, any, any> | null;
}

export function DocumentActionsMenu({
  documentId,
  documentName,
  isAdmin,
  editor,
}: DocumentActionsMenuProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const convex = useConvex();

  const guard = (fn: () => Promise<void> | void, errorMsg: string) => () => {
    if (!editor) {
      toast.error("Document is still loading.");
      return;
    }
    void (async () => {
      try {
        await fn();
      } catch (err) {
        console.error(err);
        toast.error(errorMsg);
      }
    })();
  };

  return (
    <>
      <ResponsiveDropdownMenu>
        <ResponsiveDropdownMenuTrigger
          render={
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title="Share & download"
            >
              <Share2 className="size-4" />
            </button>
          }
        />
        <ResponsiveDropdownMenuContent align="end" className="w-52 rounded-lg">
          {isAdmin && (
            <>
              <ResponsiveDropdownMenuItem onSelect={() => setShareOpen(true)}>
                <Share2 className="text-muted-foreground" />
                <span>Share…</span>
              </ResponsiveDropdownMenuItem>
              <ResponsiveDropdownMenuSeparator />
            </>
          )}
          <ResponsiveDropdownMenuItem
            onSelect={guard(async () => {
              const m = await loadExporters();
              const ctx = await m.buildExportContext(convex, editor!.document as any[], { isDark: false });
              m.exportDocumentMarkdown(editor!, documentName, ctx);
            }, "Failed to export Markdown.")}
          >
            <FileText className="text-muted-foreground" />
            <span>Download as Markdown</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuItem
            onSelect={guard(async () => {
              const m = await loadExporters();
              const ctx = await m.buildExportContext(convex, editor!.document as any[], { isDark: false });
              m.exportDocumentHTML(editor!, documentName, ctx);
            }, "Failed to export HTML.")}
          >
            <Code2 className="text-muted-foreground" />
            <span>Download as HTML</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuItem
            onSelect={guard(async () => {
              const m = await loadExporters();
              const ctx = await m.buildExportContext(convex, editor!.document as any[], { isDark: false });
              await m.exportDocumentDocx(editor!, documentName, ctx);
            }, "Failed to export DOCX.")}
          >
            <FileType2 className="text-muted-foreground" />
            <span>Download as DOCX</span>
          </ResponsiveDropdownMenuItem>
        </ResponsiveDropdownMenuContent>
      </ResponsiveDropdownMenu>
      {isAdmin && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          resourceType="document"
          resourceId={documentId}
          resourceName={documentName}
        />
      )}
    </>
  );
}
