import { QueryParams } from "@shared/types/routes";
import { useParams } from "react-router-dom";

export function Spreadsheets() {
  const { workspaceId } = useParams<QueryParams>();

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center text-muted-foreground">
      Select a spreadsheet from the sidebar or create a new one
    </div>
  );
}
