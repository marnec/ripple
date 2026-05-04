import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex-helpers/react/cache";
import { AlertCircle, Table } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSpreadsheetCellPreview } from "@/hooks/use-spreadsheet-cell-preview";
import { RepointCellRefDialog } from "@/pages/App/Document/RepointCellRefDialog";

// ---------------------------------------------------------------------------
// spreadsheetLink: navigable link to a spreadsheet (no cell reference)
// ---------------------------------------------------------------------------

export const SpreadsheetLink = createReactInlineContentSpec(
  {
    type: "spreadsheetLink",
    propSchema: {
      spreadsheetId: { default: "" },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { spreadsheetId } = inlineContent.props;
      if (!spreadsheetId) {
        return (
          <span className="text-muted-foreground italic">#deleted-spreadsheet</span>
        );
      }
      return <SpreadsheetLinkView spreadsheetId={spreadsheetId as Id<"spreadsheets">} />;
    },
  },
);

function SpreadsheetLinkView({ spreadsheetId }: { spreadsheetId: Id<"spreadsheets"> }) {
  const spreadsheet = useQuery(api.spreadsheets.get, { id: spreadsheetId });
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (spreadsheet && workspaceId) {
      void navigate(`/workspaces/${workspaceId}/spreadsheets/${spreadsheetId}`);
    }
  };

  if (spreadsheet === undefined) {
    return <span className="inline-block h-5 w-24 align-middle" />;
  }

  if (spreadsheet === null) {
    return (
      <span className="text-muted-foreground italic align-middle">
        #deleted-spreadsheet
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-sm font-medium cursor-pointer hover:bg-muted/80 transition-colors align-middle animate-fade-in"
      contentEditable={false}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick(e as unknown as React.MouseEvent);
        }
      }}
    >
      <Table className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-50 truncate">{spreadsheet.name}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// spreadsheetCellRef: inline reference to a cell or range with cached value
// ---------------------------------------------------------------------------

export const SpreadsheetCellRef = createReactInlineContentSpec(
  {
    type: "spreadsheetCellRef",
    propSchema: {
      spreadsheetId: { default: "" },
      cellRef: { default: "" },
      stableRef: { default: "" },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent, updateInlineContent }) => {
      const { spreadsheetId, cellRef, stableRef } = inlineContent.props;
      if (!spreadsheetId || !cellRef) {
        return (
          <span className="text-muted-foreground italic">#deleted-spreadsheet-ref</span>
        );
      }
      return (
        <SpreadsheetCellRefView
          spreadsheetId={spreadsheetId as Id<"spreadsheets">}
          cellRef={cellRef}
          stableRef={stableRef || undefined}
          onRepoint={(nextCellRef, nextStableRef) => {
            updateInlineContent({
              type: "spreadsheetCellRef",
              props: {
                spreadsheetId,
                cellRef: nextCellRef,
                stableRef: nextStableRef ?? "",
              },
            });
          }}
        />
      );
    },
  },
);

function SpreadsheetCellRefView({
  spreadsheetId,
  cellRef,
  stableRef,
  onRepoint,
}: {
  spreadsheetId: Id<"spreadsheets">;
  cellRef: string;
  stableRef?: string;
  onRepoint: (cellRef: string, stableRef: string | null) => void;
}) {
  const spreadsheet = useQuery(api.spreadsheets.get, { id: spreadsheetId });
  const { values: localValues, isLoading: localLoading, orphan, liveCellRef } =
    useSpreadsheetCellPreview(spreadsheetId, stableRef ?? "");
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const [repointOpen, setRepointOpen] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (spreadsheet && workspaceId) {
      void navigate(`/workspaces/${workspaceId}/spreadsheets/${spreadsheetId}`);
    }
  };

  const handleOrphanClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRepointOpen(true);
  };

  if (spreadsheet === null) {
    return (
      <span className="text-muted-foreground italic align-middle">
        #deleted-spreadsheet-ref
      </span>
    );
  }

  // Loading state — show skeleton only when both local and metadata are loading
  if (spreadsheet === undefined || (localLoading && !localValues)) {
    return <span className="inline-block h-5 w-8 align-middle" />;
  }

  const caption = `${spreadsheet.name} \u203A ${liveCellRef ?? cellRef}`;

  if (orphan) {
    return (
      <>
        <OrphanCellChip
          tooltip={`${caption} \u2014 click to repoint`}
          onClick={handleOrphanClick}
        />
        {repointOpen && (
          <RepointCellRefDialog
            open={repointOpen}
            onOpenChange={setRepointOpen}
            spreadsheetId={spreadsheetId}
            spreadsheetName={spreadsheet?.name ?? ""}
            mode="cell"
            initialCellRef={cellRef}
            onRepoint={onRepoint}
          />
        )}
      </>
    );
  }

  const values: string[][] = localValues ?? [[""]];

  return (
    <CellValueChip
      value={values[0]?.[0] ?? ""}
      tooltip={caption}
      onClick={handleClick}
    />
  );
}

// ---------------------------------------------------------------------------
// OrphanCellChip: amber-bordered chip for refs whose row/col was deleted.
// ---------------------------------------------------------------------------

function OrphanCellChip({
  tooltip,
  onClick,
}: {
  tooltip: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger
          render={<span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500 bg-amber-50 text-amber-900 text-sm font-mono cursor-pointer hover:bg-amber-100 transition-colors align-middle animate-fade-in dark:bg-amber-950/40 dark:text-amber-200"
            contentEditable={false}
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(e as unknown as React.MouseEvent);
              }
            }}
          />}
        >
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>#REF!</span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <span className="text-xs">{tooltip}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// CellValueChip: single-cell inline chip (no icon, clean mono value)
// ---------------------------------------------------------------------------

function CellValueChip({
  value,
  tooltip,
  onClick,
}: {
  value: string;
  tooltip: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger
          render={<span
            className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-sm font-mono cursor-pointer hover:bg-muted/80 transition-colors align-middle animate-fade-in"
            contentEditable={false}
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(e as unknown as React.MouseEvent);
              }
            }}
          />}
        >
            {value || "\u00A0"}
        </TooltipTrigger>
        <TooltipContent side="top">
          <span className="text-xs">{tooltip}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

