import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useParams } from "react-router-dom";
import { QueryParams } from "@shared/types/routes";

export function WorkspaceDetails() {
  const { workspaceId } = useParams<QueryParams>();

  // Fetch workspace details
  const workspace = useQuery(api.workspaces.get, {
    id: workspaceId as Id<"workspaces">,
  });

  // Fetch members of the workspace
  const members = useQuery(api.workspaceMembers.byWorkspace, {
    workspaceId: workspaceId as Id<"workspaces">,
  });

  return (
    <div className="container mx-auto p-4">
      {workspace ? (
        <>
          <h1 className="text-2xl font-semibold">Workspace {workspace.name}</h1>
          <p className="text-sm text-muted-foreground">
            Workspace Description:{" "}
            {workspace.description || "No description available."}
          </p>

          <h2 className="mt-4 text-lg font-semibold">Members</h2>
          {members && members.length > 0 ? (
            <ul className="list-disc pl-5">
              {members.map((member) => (
                <li key={member._id} className="text-sm">
                  {member.userId}{" "}
                  {/* Assuming userId is a string; you may want to fetch user details for a better display */}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No members in this workspace.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Loading workspace details...
        </p>
      )}
    </div>
  );
}
