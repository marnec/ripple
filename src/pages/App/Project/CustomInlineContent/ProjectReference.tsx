import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";

export const ProjectReference = createReactInlineContentSpec(
  {
    type: "projectReference",
    propSchema: {
      projectId: {
        default: "" as unknown as string,
      },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { projectId } = inlineContent.props;
      if (!projectId) {
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-background/60 text-muted-foreground text-sm align-middle">
            #inaccessible-project
          </span>
        );
      }
      return <ProjectReferenceView projectId={projectId as Id<"projects">} />;
    },
  }
);

const ProjectReferenceView = ({
  projectId,
}: {
  projectId: Id<"projects">;
}) => {
  const project = useQuery(api.projects.get, { id: projectId });
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (project && workspaceId) {
      void navigate(`/workspaces/${workspaceId}/projects/${projectId}`);
    }
  };

  if (project === undefined) {
    return (
      <Skeleton className="h-5 w-24 rounded-full inline-block align-middle" />
    );
  }

  if (project === null) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-background/60 text-muted-foreground text-sm align-middle">
        #inaccessible-project
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-sm font-medium cursor-pointer hover:bg-muted/80 transition-colors align-middle"
      contentEditable={false}
      onClick={handleClick}
    >
      <span className={cn("h-2 w-2 rounded-full shrink-0", project.color)} />
      <span className="max-w-[200px] truncate">{project.name}</span>
    </span>
  );
};
