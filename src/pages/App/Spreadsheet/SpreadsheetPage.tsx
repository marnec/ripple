import { LoadingSpinner } from "@/components/ui/loading-spinner";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useRef, useEffect } from "react";
import jspreadsheet from "jspreadsheet-ce";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jspreadsheet-ce/dist/jspreadsheet.themes.css";
import "jsuites/dist/jsuites.css";

function useMaterialIcons() {
  useEffect(() => {
    const id = "material-icons-font";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css?family=Material+Icons";
    document.head.appendChild(link);
  }, []);
}

function JSpreadsheetGrid() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  useMaterialIcons();

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // Create a fresh container each mount — jspreadsheet-ce inserts toolbar
    // as a sibling of the target element, so we need to wipe the entire wrapper
    wrapper.innerHTML = "";
    const container = document.createElement("div");
    wrapper.appendChild(container);

    jspreadsheet(container, {
      worksheets: [{
        minDimensions: [10, 20],
      }],
      tabs: true,
      toolbar: true,
    });

    return () => {
      try {
        jspreadsheet.destroy(container as unknown as jspreadsheet.JspreadsheetInstanceElement);
      } catch {
        // jspreadsheet-ce may throw during destroy
      }
      wrapper.innerHTML = "";
    };
  }, []);

  return <div ref={wrapperRef} />;
}

function SpreadsheetEditor({ spreadsheetId }: { spreadsheetId: Id<"spreadsheets"> }) {
  const spreadsheet = useQuery(api.spreadsheets.get, { id: spreadsheetId });

  if (spreadsheet === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  if (spreadsheet === null) {
    return <SomethingWentWrong />;
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="border-b px-4 py-2">
        <h1 className="text-lg font-semibold">{spreadsheet.name}</h1>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <JSpreadsheetGrid />
      </div>
    </div>
  );
}

export function SpreadsheetPage() {
  const { spreadsheetId } = useParams<QueryParams>();

  if (!spreadsheetId) return <SomethingWentWrong />;

  return <SpreadsheetEditor key={spreadsheetId} spreadsheetId={spreadsheetId} />;
}
