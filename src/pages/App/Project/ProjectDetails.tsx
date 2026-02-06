import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
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
  const [view, setView] = useState<"list" | "board">("board");
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
    <div
      className={
        view === "board"
          ? "container mx-auto p-6 max-w-full"
          : "container mx-auto p-6 max-w-5xl"
      }
    >
      {/* Project Header */}
      <div className="flex items-center gap-3 mb-6">
        <span className={`w-4 h-4 rounded-full ${project.color}`} />
        <h1 className="text-2xl font-bold">{project.name}</h1>
      </div>

      {project.description && (
        <p className="text-muted-foreground mb-6">{project.description}</p>
      )}

      {/* View Toggle and Content */}
      <Tabs value={view} onValueChange={(v) => setView(v as "list" | "board")}>
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

        <TabsContent value="board" className="mt-0">
          <KanbanBoard projectId={projectId} workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="list" className="mt-0">
          <Tasks projectId={projectId} workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
