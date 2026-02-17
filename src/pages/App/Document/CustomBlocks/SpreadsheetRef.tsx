import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex/react";
import { Table } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isSingleCell } from "@shared/cellRef";

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
    return <Skeleton className="h-5 w-24 rounded inline-block align-middle" />;
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
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-sm font-medium cursor-pointer hover:bg-muted/80 transition-colors align-middle"
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
  const cellData = useQuery(api.spreadsheetCellRefs.getCellRef, {
    spreadsheetId,
    cellRef,
  });
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

  const single = isSingleCell(cellRef);

  // Loading state
  if (spreadsheet === undefined || cellData === undefined) {
    if (single) {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-sm font-mono align-middle">
          <Skeleton className="h-4 w-8 rounded inline-block" />
        </span>
      );
    }
    return (
      <span className="block my-1.5" contentEditable={false}>
        <Skeleton className="h-16 w-48 rounded-lg" />
      </span>
    );
  }

  const values: string[][] = cellData?.values ?? [[""]];
  const caption = `${spreadsheet.name} \u203A ${cellRef}`;

  if (single) {
    return (
      <CellValueChip
        value={values[0]?.[0] ?? ""}
        tooltip={caption}
        onClick={handleClick}
      />
    );
  }

  return (
    <RangeTable
      values={values}
      caption={caption}
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
            className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-sm font-mono cursor-pointer hover:bg-muted/80 transition-colors align-middle"
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

// ---------------------------------------------------------------------------
// RangeTable: block-level readonly table with caption (matches native BN table)
// ---------------------------------------------------------------------------

function RangeTable({
  values,
  caption,
  onClick,
}: {
  values: string[][];
  caption: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <span
      className="block my-1.5 cursor-pointer"
      contentEditable={false}
      onClick={onClick}
    >
      <span className="block border border-border rounded-lg overflow-hidden">
        <span className="flex justify-end">
          <span className="text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded-bl">
            {caption}
          </span>
        </span>
        <table className="border-collapse w-full">
          <tbody>
            {values.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="border border-border px-3 py-1.5 text-sm"
                  >
                    {cell || "\u00A0"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </span>
    </span>
  );
}
