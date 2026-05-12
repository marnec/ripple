import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type { QueryParams } from "@ripple/shared/types/routes";

// Placeholder destination for the workspace dashboard's "Tags" counter.
// There's no real tag-management surface yet; this just acknowledges that
// the user followed the link so the counter feels like a normal card
// instead of a dead pixel.
export function TagsEasterEgg() {
  const { workspaceId } = useParams<QueryParams>();

  return (
    <div className="animate-fade-in flex flex-col items-center justify-center h-[calc(100vh-64px)] gap-4 px-6 text-center">
      <Sparkles className="size-10 text-muted-foreground" />
      <h1 className="text-2xl font-semibold">You got here. Well done.</h1>
      <p className="text-sm text-muted-foreground max-w-sm">
        There's no tag page yet — tags currently live attached to the
        resources that use them. Now go back.
      </p>
      <Button
        size="sm"
        variant="outline"
        render={<Link to={`/workspaces/${workspaceId}`} />}
        className="inline-flex items-center gap-1.5"
      >
        <ArrowLeft className="size-4" />
        Back to workspace
      </Button>
    </div>
  );
}
