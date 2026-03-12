import { useState, useEffect, useMemo } from "react";
import { useAction } from "convex/react";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import {
  FileText,
  Heading,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Type,
} from "lucide-react";
import { RippleSpinner } from "@/components/RippleSpinner";
import type { BlockPreview } from "@shared/blockRef";

const blockTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  paragraph: Type,
  heading: Heading,
  bulletListItem: List,
  numberedListItem: ListOrdered,
  checkListItem: CheckSquare,
  quote: Quote,
};

const blockTypeLabels: Record<string, string> = {
  paragraph: "Paragraph",
  heading: "Heading",
  bulletListItem: "Bullet list",
  numberedListItem: "Numbered list",
  checkListItem: "Checklist",
  quote: "Quote",
};

function BlockPickerBody({
  search,
  setSearch,
  isLoading,
  filtered,
  blocks,
  onSelect,
}: {
  search: string;
  setSearch: (v: string) => void;
  isLoading: boolean;
  filtered: BlockPreview[];
  blocks: BlockPreview[] | null;
  onSelect: (blockId: string) => void;
}) {
  return (
    <ResponsiveDialogBody className="flex flex-col gap-3">
      <Input
        placeholder="Search blocks..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RippleSpinner size={32} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {(blocks?.length ?? 0) === 0
              ? "No embeddable text blocks found in this document."
              : "No blocks match your search."}
          </div>
        ) : (
          <div className="space-y-1 py-2">
            {filtered.map((block) => {
              const Icon = blockTypeIcons[block.type] ?? Type;
              const label = blockTypeLabels[block.type] ?? block.type;

              return (
                <button
                  key={block.blockId}
                  type="button"
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-muted transition-colors group"
                  onClick={() => onSelect(block.blockId)}
                >
                  <div className="flex items-start gap-2">
                    <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm leading-snug line-clamp-2 ${block.type === "heading" ? "font-semibold" : ""}`}>
                        {block.text}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {label}
                        {block.level ? ` ${block.level}` : ""}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </ResponsiveDialogBody>
  );
}

interface BlockPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: Id<"documents">;
  documentName: string;
  onInsert: (blockId: string) => void;
}

export function BlockPickerDialog({
  open,
  onOpenChange,
  documentId,
  documentName,
  onInsert,
}: BlockPickerDialogProps) {
  const getDocumentBlocks = useAction(api.documentBlockRefsNode.getDocumentBlocks);
  const [blocks, setBlocks] = useState<BlockPreview[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;

    let stale = false;
    void getDocumentBlocks({ documentId }).then((result) => {
      if (!stale) setBlocks(result);
    });
    return () => { stale = true; };
  }, [open, documentId, getDocumentBlocks]);

  const isLoading = open && blocks === null;

  const filtered = useMemo(() => {
    if (!blocks) return [];
    if (!search.trim()) return blocks;
    const q = search.toLowerCase();
    return blocks.filter((b) => b.text.toLowerCase().includes(q));
  }, [blocks, search]);

  const handleSelect = (blockId: string) => {
    onInsert(blockId);
    onOpenChange(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setBlocks(null);
      setSearch("");
    }
    onOpenChange(next);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span className="truncate">Embed block from {documentName}</span>
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Select a block to embed. Only text blocks can be referenced.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <BlockPickerBody
          search={search}
          setSearch={setSearch}
          isLoading={isLoading}
          filtered={filtered}
          blocks={blocks}
          onSelect={handleSelect}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
