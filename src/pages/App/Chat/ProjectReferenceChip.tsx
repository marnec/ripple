import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useMentionedProjects } from "./MentionedUsersContext";

type ProjectReferenceChipProps = {
  projectId: string;
};

export function ProjectReferenceChip({ projectId }: ProjectReferenceChipProps) {
  const mentionedProjects = useMentionedProjects();
  const cached = mentionedProjects[projectId];

  const project = useQuery(api.projects.get, cached ? "skip" : {
    id: projectId as Id<"projects">,
  });
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  if (cached) {
    const handleClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void navigate(`/workspaces/${workspaceId}/projects/${projectId}`);
    };

    return (
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 px-2 py-0.5
                   rounded-full bg-background/60 hover:bg-background/80
                   transition-colors cursor-pointer text-sm font-medium align-middle"
      >
        <span className={cn("h-2 w-2 rounded-full shrink-0", cached.color)} />
        <span className="max-w-50 truncate">{cached.name}</span>
      </button>
    );
  }

  // Inaccessible or deleted
  if (!project) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5
                       rounded-full bg-background/60 text-muted-foreground
                       text-sm align-middle">
        #inaccessible-project
      </span>
    );
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigate(`/workspaces/${workspaceId}/projects/${project._id}`);
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 px-2 py-0.5
                 rounded-full bg-background/60 hover:bg-background/80
                 transition-colors cursor-pointer text-sm font-medium align-middle"
    >
      <span className={cn("h-2 w-2 rounded-full shrink-0", project.color)} />
      <span className="max-w-50 truncate">{project.name}</span>
    </button>
  );
}
