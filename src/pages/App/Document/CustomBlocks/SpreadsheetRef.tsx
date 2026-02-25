import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex/react";
import { Table } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSpreadsheetCellPreview } from "@/hooks/use-spreadsheet-cell-preview";

// ---------------------------------------------------------------------------
// spreadsheetLink: navigable link to a spreadsheet (no cell reference)
// ---------------------------------------------------------------------------

export const SpreadsheetLink = createReactInlineContentSpec(
  {
    type: "spreadsheetLink",
    propSchema: {
      spreadsheetId: { default: "" as unknown as string },
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
      spreadsheetId: { default: "" as unknown as string },
      cellRef: { default: "" },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { spreadsheetId, cellRef } = inlineContent.props;
      if (!spreadsheetId || !cellRef) {
        return (
          <span className="text-muted-foreground italic">#deleted-spreadsheet-ref</span>
        );
      }
      return (
        <SpreadsheetCellRefView
          spreadsheetId={spreadsheetId as Id<"spreadsheets">}
          cellRef={cellRef}
        />
      );
    },
  },
);

function SpreadsheetCellRefView({
  spreadsheetId,
  cellRef,
}: {
  spreadsheetId: Id<"spreadsheets">;
  cellRef: string;
}) {
  const spreadsheet = useQuery(api.spreadsheets.get, { id: spreadsheetId });
  const { values: localValues, isLoading: localLoading } =
    useSpreadsheetCellPreview(spreadsheetId, cellRef);
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (spreadsheet && workspaceId) {
      void navigate(`/workspaces/${workspaceId}/spreadsheets/${spreadsheetId}`);
    }
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

  const values: string[][] = localValues ?? [[""]];
  const caption = `${spreadsheet.name} \u203A ${cellRef}`;

  return (
    <CellValueChip
      value={values[0]?.[0] ?? ""}
      tooltip={caption}
      onClick={handleClick}
    />
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
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-sm font-mono cursor-pointer hover:bg-muted/80 transition-colors align-middle animate-fade-in"
            contentEditable={false}
            onClick={onClick}
          >
            {value || "\u00A0"}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <span className="text-xs">{tooltip}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

