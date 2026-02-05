import { LoadingSpinner } from "@/components/ui/loading-spinner";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { FolderKanban } from "lucide-react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

export function ProjectDetails() {
  const { workspaceId, projectId } = useParams<QueryParams>();

  if (!workspaceId || !projectId) {
    return <SomethingWentWrong />;
  }

  return (
    <ProjectDetailsContent
      workspaceId={workspaceId}
      projectId={projectId}
    />
  );
}

function ProjectDetailsContent({
  workspaceId: _workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const project = useQuery(api.projects.get, { id: projectId });

  if (project === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  if (project === null) {
    return <SomethingWentWrong />;
  }

  return (
    <div className="container mx-auto py-6">
      {/* Project Header */}
      <div className="flex items-center gap-3 mb-6">
        <span className={`w-4 h-4 rounded-full ${project.color}`} />
        <h1 className="text-2xl font-bold">{project.name}</h1>
      </div>

      {project.description && (
        <p className="text-muted-foreground mb-6">{project.description}</p>
      )}

      {/* Empty state for tasks (Kanban board comes in Phase 3) */}
      <div className="border-2 border-dashed rounded-lg p-12 text-center">
        <FolderKanban className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-lg font-medium mb-2">No tasks yet</h2>
        <p className="text-muted-foreground">
          Tasks and Kanban board will be available in a future update.
        </p>
      </div>
    </div>
  );
}
