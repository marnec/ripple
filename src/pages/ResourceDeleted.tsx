import { Button } from "@/components/ui/button";
import { FileX2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

type ResourceDeletedProps = {
  resourceType: "document" | "diagram" | "spreadsheet";
};

export function ResourceDeleted({ resourceType }: ResourceDeletedProps) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <FileX2 className="h-12 w-12 text-muted-foreground mb-4" />
      <h2 className="text-xl font-semibold mb-2">
        This {resourceType} has been deleted
      </h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        It may have been removed by a workspace member. Any links or embeds
        pointing here will no longer work.
      </p>
      <Button variant="outline" onClick={() => void navigate(-1)}>
        Go back
      </Button>
    </div>
  );
}
