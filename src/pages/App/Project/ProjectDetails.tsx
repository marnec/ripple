import { FavoriteButton } from "@/components/FavoriteButton";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { LayoutList, Kanban } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { KanbanBoard } from "./KanbanBoard";
import { Tasks } from "./Tasks";

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
  workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<"list" | "board">(isMobile ? "list" : "board");
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
    <div className="flex h-full w-full flex-col">
      {/* Project Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b">
        <div className="flex h-8 items-center gap-2">
          <FavoriteButton
            resourceType="project"
            resourceId={projectId}
            workspaceId={workspaceId}
          />
          <h1 className="text-lg font-semibold truncate">{project.name}</h1>
          {project.color && (
            <span className={`w-2.5 h-2.5 rounded-full ${project.color} ml-1`} />
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 p-3 md:p-6">
      {project.description && (
        <p className="text-muted-foreground mb-6">{project.description}</p>
      )}

      {/* View Toggle and Content */}
      <Tabs value={view} onValueChange={(v) => setView(v as "list" | "board")} className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="board" className="flex items-center gap-2">
              <Kanban className="h-4 w-4" />
              Board
            </TabsTrigger>
            <TabsTrigger value="list" className="flex items-center gap-2">
              <LayoutList className="h-4 w-4" />
              List
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="board" className="mt-0 flex-1 min-h-0">
          <KanbanBoard projectId={projectId} workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="list" className="mt-0 overflow-auto">
          <Tasks projectId={projectId} workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}
